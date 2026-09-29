import { fileURLToPath, pathToFileURL } from 'node:url';
import { findNearestConfigPathForFile } from '@internal/config-loader';
import { CliStructuredError } from '@internal/errors/control';
import { isPrismaNextSchema, renameLegacyDirective, type SymbolTable } from '@internal/psl-parser';
import { type FormatOptions, format } from '@internal/psl-parser/format';
import { join } from 'pathe';
import {
  type CompletionItem,
  type Connection,
  type Diagnostic,
  DiagnosticSeverity,
  DidChangeWatchedFilesNotification,
  type Disposable,
  type DocumentDiagnosticReport,
  DocumentDiagnosticReportKind,
  type FoldingRange,
  type FullDocumentDiagnosticReport,
  type InitializeParams,
  type InitializeResult,
  type Position,
  type PublishDiagnosticsParams,
  type Range,
  RegistrationRequest,
  type RelatedFullDocumentDiagnosticReport,
  type SemanticTokens,
  type SignatureHelp,
  TextDocumentSyncKind,
  type TextEdit,
} from 'vscode-languageserver';
import { classifyPslCompletionContext } from './completion-context';
import { providePslCompletionItems } from './completion-provider';
import {
  CONFIG_FILENAME,
  type ProjectInterpretation,
  resolveConfigInputs,
} from './config-resolution';
import {
  type LspDiagnostic,
  mapParseDiagnostics,
  ParseDiagnosticSeverity,
} from './diagnostic-mapping';
import { DocumentStore } from './document-store';
import { computeFoldingRanges } from './folding-ranges';
import { guardedConnection } from './guarded-connection';
import type { LspControlStack } from './lsp-control-stack';
import {
  createProjectArtifacts,
  type DocumentArtifacts,
  type ProjectArtifacts,
} from './project-artifacts';
import {
  canonicalFileIdentity,
  isWatcherCacheEligible,
  normalizeFileUri,
  resolveSchemaInputs,
  type SchemaInputConfig,
  type SchemaInputSet,
  toWatcherGlobPattern,
} from './schema-inputs';
import { buildSemanticTokens, semanticTokensLegend } from './semantic-tokens';
import { providePslSignatureHelp } from './signature-help';

export interface LanguageServer {
  dispose(): void;
  /**
   * Exposed for future features (completion, semantic tokens); nothing consumes
   * them yet.
   */
  getDocumentAst(uri: string): DocumentArtifacts | undefined;
  getProjectSymbolTable(uri: string): SymbolTable | undefined;
}

interface ProjectState {
  readonly configPath: string;
  readonly inputs: SchemaInputSet;
  readonly schemaInputConfig: SchemaInputConfig;
  readonly formatter?: FormatOptions;
  /**
   * Resolved once per config and refreshed by the config-watch path — never
   * rebuilt per document.
   */
  readonly controlStack: LspControlStack;
  readonly interpretation?: ProjectInterpretation;
  readonly artifacts: ProjectArtifacts;
}

/** One entry per managed config — never a settled load without an entry decision. */
type ManagedProject =
  | {
      readonly status: 'loading';
      readonly load: Promise<ProjectState>;
      /**
       * The project that was loaded when this load (chain) began. A failed
       * reload restores it — a broken config edit must not destroy a working
       * project. A failed first load has no last-good: it serves no project,
       * leaves its documents unmanaged, and still publishes the config
       * diagnostic (recorded by the `failed` entry).
       */
      readonly lastGood: ProjectState | undefined;
    }
  | { readonly status: 'loaded'; readonly project: ProjectState }
  | { readonly status: 'failed' };

/** The project a new load of this config could fall back to. */
function lastGoodProject(entry: ManagedProject | undefined): ProjectState | undefined {
  if (entry === undefined || entry.status === 'failed') {
    return undefined;
  }
  return entry.status === 'loaded' ? entry.project : entry.lastGood;
}

export const CONFIG_LOAD_FAILED_CODE = 'PRISMA_CONFIG_LOAD_FAILED';

const semanticTokenSourceLimit = 100_000;

export function createServer(connection: Connection): LanguageServer {
  // Guarded here rather than at each send site, so a send added later cannot
  // reach a departed client unguarded: the body below never holds the raw
  // connection.
  return createServerOn(guardedConnection(connection));
}

function createServerOn(connection: Connection): LanguageServer {
  const documents = new DocumentStore();
  const { getOpenDocument } = documents;
  const managedProjects = new Map<string, ManagedProject>();
  const documentConfigPaths = new Map<string, string>();
  const publishedMembers = new Map<string, ReadonlySet<string>>();
  const reportedRelatedMembers = new Map<string, ReadonlySet<string>>();
  const schemaWatchRegistrations = new Map<
    string,
    { readonly disposable: Disposable; readonly schemaInputConfig: SchemaInputConfig }
  >();
  const schemaWatchGenerations = new Map<string, number>();
  let rootPath = process.cwd();
  let watchedConfigGlob = join(rootPath, '**', CONFIG_FILENAME);
  let clientCapabilities = noClientCapabilities;

  function sendDiagnostics(params: PublishDiagnosticsParams): void {
    void connection.sendDiagnostics({ ...params, uri: normalizeFileUri(params.uri) });
  }

  function logWarn(message: string): void {
    connection.console.warn(message);
  }

  function publishProjectMembers(project: ProjectState): void {
    if (clientCapabilities.pullDiagnostics) return;
    const nextLedger = new Set<string>();
    const projectSymbolDiagnostics = project.artifacts.symbolDiagnostics();
    for (const candidateUri of project.inputs.uris()) {
      const artifacts = project.artifacts.document(candidateUri);
      const uri = normalizeFileUri(candidateUri);
      sendDiagnostics({
        uri,
        diagnostics:
          artifacts === undefined ? [] : combinedDiagnostics(artifacts, projectSymbolDiagnostics),
      });
      nextLedger.add(uri);
    }
    const previousLedger = publishedMembers.get(project.configPath);
    if (previousLedger !== undefined) {
      for (const uri of previousLedger) {
        if (!nextLedger.has(uri)) {
          sendDiagnostics({ uri, diagnostics: [] });
        }
      }
    }
    publishedMembers.set(project.configPath, nextLedger);
  }

  function clearPublishedMembers(configPath: string): void {
    const ledger = publishedMembers.get(configPath);
    if (ledger === undefined) {
      return;
    }
    for (const uri of ledger) {
      sendDiagnostics({ uri, diagnostics: [] });
    }
    publishedMembers.delete(configPath);
  }

  function clearSchemaWatcher(configPath: string): number {
    const generation = (schemaWatchGenerations.get(configPath) ?? 0) + 1;
    schemaWatchGenerations.set(configPath, generation);
    documents.setWatchCoverage(configPath, []);
    schemaWatchRegistrations.get(configPath)?.disposable.dispose();
    schemaWatchRegistrations.delete(configPath);
    return generation;
  }

  async function registerSchemaWatcher(project: ProjectState): Promise<void> {
    const configPath = project.configPath;
    const generation = clearSchemaWatcher(configPath);
    if (!clientCapabilities.watchedFilesRegistration) {
      return;
    }
    const patterns = project.schemaInputConfig.contract?.source.inputs ?? [];
    if (patterns.length === 0) {
      return;
    }
    try {
      const disposable = await connection.client.register(DidChangeWatchedFilesNotification.type, {
        watchers: patterns.map((pattern) => ({ globPattern: toWatcherGlobPattern(pattern) })),
      });
      if (disposable === undefined) return;
      if (schemaWatchGenerations.get(configPath) === generation) {
        schemaWatchRegistrations.set(configPath, {
          disposable,
          schemaInputConfig: project.schemaInputConfig,
        });
        const current = currentProjectState(configPath);
        if (
          current?.schemaInputConfig === project.schemaInputConfig &&
          isWatcherCacheEligible(project.schemaInputConfig)
        ) {
          documents.setWatchCoverage(configPath, current.inputs.uris());
        }
      } else {
        disposable.dispose();
      }
    } catch {}
  }

  function onProjectLoaded(project: ProjectState): void {
    void registerSchemaWatcher(project);
  }

  // The single diagnostics assembly — push and pull must serve the same
  // combined response, and interpretation runs only from here.
  function combinedDiagnostics(
    artifacts: DocumentArtifacts,
    projectSymbolDiagnostics: ReturnType<ProjectArtifacts['symbolDiagnostics']>,
  ): Diagnostic[] {
    const symbolDiagnostics = projectSymbolDiagnostics.filter(
      (diagnostic) => diagnostic.filename === artifacts.sourceFile.filename,
    );
    return toDiagnostics([
      ...artifacts.diagnostics,
      ...mapParseDiagnostics(symbolDiagnostics),
      ...artifacts.interpretDiagnostics(),
    ]);
  }

  function buildDocumentDiagnosticReport(
    project: ProjectState,
    requestedUri: string,
  ): RelatedFullDocumentDiagnosticReport {
    const uri = normalizeFileUri(requestedUri);
    const projectSymbolDiagnostics = project.artifacts.symbolDiagnostics();
    const reportFor = (memberUri: string): FullDocumentDiagnosticReport => {
      const artifacts = project.artifacts.document(memberUri);
      return {
        kind: DocumentDiagnosticReportKind.Full,
        items:
          artifacts === undefined ? [] : combinedDiagnostics(artifacts, projectSymbolDiagnostics),
      };
    };
    const members = new Set(Array.from(project.inputs.uris(), normalizeFileUri));
    const previous = reportedRelatedMembers.get(project.configPath) ?? new Set<string>();
    const relatedDocuments: Record<string, FullDocumentDiagnosticReport> = {};
    for (const memberUri of new Set([...members, ...previous])) {
      if (memberUri === uri) continue;
      relatedDocuments[memberUri] = members.has(memberUri)
        ? reportFor(memberUri)
        : { kind: DocumentDiagnosticReportKind.Full, items: [] };
    }
    const report = reportFor(uri);
    if (previous.has(uri)) members.add(uri);
    reportedRelatedMembers.set(project.configPath, members);
    return {
      ...report,
      ...(Object.keys(relatedDocuments).length > 0 ? { relatedDocuments } : {}),
    };
  }

  async function resolveProjectForDocument(uri: string): Promise<ProjectState | undefined> {
    const project = await projectForNearestConfig(uri);
    if (project === undefined || project.inputs.includes(uri)) {
      return project;
    }
    documentConfigPaths.delete(canonicalFileIdentity(uri));
    return undefined;
  }

  async function projectForNearestConfig(uri: string): Promise<ProjectState | undefined> {
    const knownConfigPath = documentConfigPaths.get(canonicalFileIdentity(uri));
    if (knownConfigPath !== undefined) {
      return resolveProjectIfLoadable(knownConfigPath);
    }

    const filePath = filePathFromUri(uri);
    if (filePath === undefined) {
      return undefined;
    }

    let configPath: string | undefined;
    try {
      configPath = await findNearestConfigPathForFile(filePath);
    } catch {
      // Config discovery walks the filesystem; a failure means "no project".
      return undefined;
    }
    if (configPath === undefined) {
      return undefined;
    }

    documentConfigPaths.set(canonicalFileIdentity(uri), configPath);
    return resolveProjectIfLoadable(configPath);
  }

  async function resolveProjectIfLoadable(configPath: string): Promise<ProjectState | undefined> {
    try {
      return await resolveProject(configPath);
    } catch {
      // Failure consequences run in the load chain itself, strictly ordered
      // before any successor load; awaiters never mutate.
      return undefined;
    }
  }

  async function resolveProject(configPath: string): Promise<ProjectState> {
    const entry = managedProjects.get(configPath);
    // A `failed` entry only records the published config marker — for
    // project resolution it behaves like absence.
    if (entry === undefined || entry.status === 'failed') {
      return startProjectLoad(configPath);
    }
    return entry.status === 'loaded' ? entry.project : entry.load;
  }

  function refreshProject(configPath: string): Promise<ProjectState> {
    return startProjectLoad(configPath);
  }

  // A load replaces the entry with `loading` immediately, so reads during a
  // config reload await the fresh resolution instead of the pre-reload
  // project.
  function startProjectLoad(configPath: string): Promise<ProjectState> {
    clearSchemaWatcher(configPath);
    const existing = managedProjects.get(configPath);
    const previousLoad = existing?.status === 'loading' ? existing.load : undefined;
    const lastGood = lastGoodProject(existing);
    const load: Promise<ProjectState> = (previousLoad ?? Promise.resolve(undefined))
      .catch(() => undefined)
      .then(() => loadProject(configPath))
      .then(
        (project) => {
          // Entry replacement is synchronous, so a superseded load's own
          // continuation stays silent.
          if (isCurrentLoad(configPath, load)) {
            managedProjects.set(configPath, { status: 'loaded', project });
            // Unconditional: clients keep per-server diagnostic state, so an
            // empty publish is harmless when no marker is outstanding.
            clearConfigFailure(configPath);
            onProjectLoaded(project);
          }
          return project;
        },
        (error: unknown) => {
          // Same guard as above. All failure consequences live here — the
          // queue orders this handler strictly before any successor load.
          if (isCurrentLoad(configPath, load)) {
            publishConfigFailure(configPath, error);
            if (lastGood !== undefined) {
              managedProjects.set(configPath, { status: 'loaded', project: lastGood });
              onProjectLoaded(lastGood);
              return lastGood;
            }
            managedProjects.set(configPath, { status: 'failed' });
            unmanageDocuments(configPath);
            clearSchemaWatcher(configPath);
            clearPublishedMembers(configPath);
          }
          throw error;
        },
      );
    managedProjects.set(configPath, { status: 'loading', load, lastGood });
    return load;
  }

  function publishConfigFailure(configPath: string, error: unknown): void {
    sendDiagnostics({
      uri: pathToFileURL(configPath).toString(),
      diagnostics: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: configFailureMessage(error),
          code: CONFIG_LOAD_FAILED_CODE,
          severity: DiagnosticSeverity.Error,
          source: 'prisma',
        },
      ],
    });
  }

  function configFailureMessage(error: unknown): string {
    if (CliStructuredError.is(error)) {
      return error.why ?? error.message;
    }
    return error instanceof Error ? error.message : String(error);
  }

  function clearConfigFailure(configPath: string): void {
    sendDiagnostics({ uri: pathToFileURL(configPath).toString(), diagnostics: [] });
  }

  function isCurrentLoad(configPath: string, load: Promise<ProjectState>): boolean {
    const entry = managedProjects.get(configPath);
    return entry?.status === 'loading' && entry.load === load;
  }

  async function loadProject(configPath: string): Promise<ProjectState> {
    const readText = (uri: string): string | undefined => documents.text(uri);
    const resolution = await resolveConfigInputs(configPath, readText);
    // A fresh store per load: a config reload can change what a parse
    // produces (inputs, control stack), so later reads must derive from the
    // new resolution rather than anything computed under the old one.
    const artifacts = createProjectArtifacts({
      inputs: resolution.inputs,
      readSnapshot: documents.readSnapshot,
      onInterpretationError: (uri, error) => {
        const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
        connection.console.error(`PSL interpretation failed for ${uri}: ${detail}`);
      },
      ...(resolution.interpretation === undefined
        ? {}
        : { interpretation: resolution.interpretation }),
    });
    const project: ProjectState = {
      configPath,
      inputs: resolution.inputs,
      schemaInputConfig: resolution.schemaInputConfig,
      controlStack: resolution.controlStack,
      artifacts,
      ...(resolution.formatter === undefined ? {} : { formatter: resolution.formatter }),
      ...(resolution.interpretation === undefined
        ? {}
        : { interpretation: resolution.interpretation }),
    };
    return project;
  }

  // A failed first load serves no project: its documents drop their
  // association and re-resolve (and retry the load) on their next read.
  function unmanageDocuments(configPath: string): void {
    for (const document of documents.openDocuments()) {
      if (documentConfigPaths.get(canonicalFileIdentity(document.uri)) === configPath) {
        documentConfigPaths.delete(canonicalFileIdentity(document.uri));
      }
    }
  }

  async function publishForDocument(uri: string): Promise<void> {
    const project = await resolveProjectForDocument(uri);
    if (project === undefined) {
      return;
    }
    publishProjectMembers(project);
  }

  function publishForDocumentSafely(uri: string): void {
    void publishForDocument(uri).catch((error: unknown) => {
      connection.console.error(error instanceof Error ? error.message : String(error));
    });
  }

  async function formatDocument(uri: string): Promise<TextEdit[]> {
    const document = getOpenDocument(uri);
    if (document === undefined) {
      return [];
    }

    const source = document.getText();
    if (!isPrismaNextSchema(source)) {
      return [];
    }

    const project = await resolveProjectForDocument(uri);
    if (project === undefined) {
      return [];
    }

    let formatted: string;
    try {
      formatted = renameLegacyDirective(format(source, project.formatter));
    } catch {
      return [];
    }

    if (formatted === source) {
      return [];
    }

    return [
      {
        range: { start: { line: 0, character: 0 }, end: document.positionAt(source.length) },
        newText: formatted,
      },
    ];
  }

  async function semanticTokensForDocument(uri: string, range?: Range): Promise<SemanticTokens> {
    const document = getOpenDocument(uri);
    if (document === undefined) {
      return emptySemanticTokens();
    }
    const text = document.getText();
    if (text.length > semanticTokenSourceLimit) {
      return emptySemanticTokens();
    }

    const project = await resolveProjectForDocument(uri);
    if (project === undefined) {
      return emptySemanticTokens();
    }

    const artifacts = project.artifacts.document(uri);
    if (artifacts === undefined) {
      return emptySemanticTokens();
    }

    const source = {
      document: artifacts.document,
      sourceFile: artifacts.sourceFile,
      symbolTable: project.artifacts.symbolTable(),
      scalarTypes: project.controlStack.scalarTypes,
    };
    return buildSemanticTokens(source, range);
  }

  async function completeDocument(uri: string, position: Position): Promise<CompletionItem[]> {
    const document = getOpenDocument(uri);
    if (document === undefined) {
      return [];
    }

    const project = await resolveProjectForDocument(uri);
    if (project === undefined) {
      return [];
    }

    const artifacts = project.artifacts.document(uri);
    if (artifacts === undefined) {
      return [];
    }

    try {
      const context = classifyPslCompletionContext({
        document: artifacts.document,
        sourceFile: artifacts.sourceFile,
        position,
      });
      return [
        ...providePslCompletionItems({
          context,
          sourceFile: artifacts.sourceFile,
          candidates: {
            scalarTypes: project.controlStack.scalarTypes,
            pslBlockDescriptors: project.controlStack.pslBlockDescriptors,
            symbolTable: project.artifacts.symbolTable(),
            ...(project.controlStack.authoringContributions === undefined
              ? {}
              : { authoringContributions: project.controlStack.authoringContributions }),
            ...(project.controlStack.controlMutationDefaults === undefined
              ? {}
              : { controlMutationDefaults: project.controlStack.controlMutationDefaults }),
          },
          clientSupportsSnippets: clientCapabilities.completionSnippets,
          clientSupportsTriggerSuggestCommand: clientCapabilities.completionTriggerSuggestCommand,
          clientSupportsTriggerParameterHintsCommand:
            clientCapabilities.completionTriggerParameterHintsCommand,
        }),
      ];
    } catch {
      return [];
    }
  }

  async function signatureHelpForDocument(
    uri: string,
    position: Position,
  ): Promise<SignatureHelp | null> {
    if (getOpenDocument(uri) === undefined) return null;
    const project = await resolveProjectForDocument(uri);
    if (project === undefined) return null;
    const artifacts = project.artifacts.document(uri);
    if (artifacts === undefined) return null;

    try {
      return providePslSignatureHelp({
        clientSupportsLabelOffsets: clientCapabilities.signatureLabelOffsets,
        document: artifacts.document,
        sourceFile: artifacts.sourceFile,
        position,
        candidates: {
          pslBlockDescriptors: project.controlStack.pslBlockDescriptors,
          symbolTable: project.artifacts.symbolTable(),
          ...(project.controlStack.authoringContributions === undefined
            ? {}
            : { authoringContributions: project.controlStack.authoringContributions }),
          ...(project.controlStack.controlMutationDefaults === undefined
            ? {}
            : { controlMutationDefaults: project.controlStack.controlMutationDefaults }),
        },
      });
    } catch {
      return null;
    }
  }

  connection.onInitialize(async (params): Promise<InitializeResult> => {
    rootPath = resolveRootPath(params);
    watchedConfigGlob = join(rootPath, '**', CONFIG_FILENAME);
    clientCapabilities = resolveClientCapabilities(params);

    return {
      capabilities: {
        textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Incremental },
        documentFormattingProvider: true,
        foldingRangeProvider: true,
        semanticTokensProvider: {
          legend: semanticTokensLegend,
          full: true,
          range: true,
        },
        completionProvider: { triggerCharacters: ['.', '@', '[', '(', '{', ':', ','] },
        signatureHelpProvider: { triggerCharacters: ['(', ','] },
        ...(clientCapabilities.pullDiagnostics
          ? {
              diagnosticProvider: {
                interFileDependencies: true,
                workspaceDiagnostics: false,
              },
            }
          : {}),
      },
    };
  });

  connection.onInitialized(() => {
    if (clientCapabilities.watchedFilesRegistration) {
      void connection.sendRequest(RegistrationRequest.type, {
        registrations: [
          {
            id: 'prisma-8-config-watcher',
            method: DidChangeWatchedFilesNotification.type.method,
            registerOptions: { watchers: [{ globPattern: watchedConfigGlob }] },
          },
        ],
      });
    } else {
      logWarn(
        'Client does not support dynamic file-watcher registration; Prisma 8 config changes will not be picked up without a restart.',
      );
    }
  });

  async function handleSchemaMemberChange(uri: string): Promise<boolean> {
    documents.invalidate(uri);
    const filePath = filePathFromUri(uri);
    if (filePath === undefined) {
      return false;
    }
    let configPath: string | undefined;
    try {
      configPath = await findNearestConfigPathForFile(filePath);
    } catch {
      return false;
    }
    if (configPath === undefined) {
      return false;
    }
    const entry = managedProjects.get(configPath);
    if (entry === undefined || entry.status === 'failed') {
      return false;
    }
    const project =
      entry.status === 'loaded' ? entry.project : await entry.load.catch(() => undefined);
    if (project === undefined) {
      return false;
    }
    const readText = (candidate: string): string | undefined => documents.text(candidate);
    const nextInputs = await resolveSchemaInputs(project.schemaInputConfig, readText);
    project.artifacts.documentChanged(uri);
    project.artifacts.updateInputs(nextInputs);
    const updated: ProjectState = { ...project, inputs: nextInputs };
    managedProjects.set(configPath, { status: 'loaded', project: updated });
    if (
      schemaWatchRegistrations.get(configPath)?.schemaInputConfig === project.schemaInputConfig &&
      isWatcherCacheEligible(project.schemaInputConfig)
    ) {
      documents.setWatchCoverage(configPath, nextInputs.uris());
    }
    publishProjectMembers(updated);
    return true;
  }

  connection.onDidChangeWatchedFiles(async (params) => {
    const configChanges: string[] = [];
    const memberChanges: string[] = [];
    for (const change of params.changes) {
      const filePath = filePathFromUri(change.uri);
      (filePath?.endsWith(CONFIG_FILENAME) ? configChanges : memberChanges).push(change.uri);
    }

    const changedConfigPaths = configPathsFromWatchedChanges(configChanges.map(filePathFromUri));
    for (const configPath of changedConfigPaths) {
      if (managedProjects.has(configPath)) {
        try {
          const project = await refreshProject(configPath);
          publishProjectMembers(project);
        } catch {
          // Failure consequences live in the load chain; nothing to do here.
        }
      }
    }

    let handledMemberChange = false;
    for (const uri of memberChanges) {
      if (await handleSchemaMemberChange(uri)) {
        handledMemberChange = true;
      }
    }

    if (
      clientCapabilities.pullDiagnostics &&
      clientCapabilities.diagnosticsRefresh &&
      (changedConfigPaths.size > 0 || handledMemberChange)
    ) {
      void connection.languages.diagnostics.refresh();
    }
  });

  connection.onDocumentFormatting((params) => formatDocument(params.textDocument.uri));
  connection.onCompletion((params) => completeDocument(params.textDocument.uri, params.position));
  connection.onSignatureHelp((params) =>
    signatureHelpForDocument(params.textDocument.uri, params.position),
  );

  connection.languages.semanticTokens.on((params) =>
    semanticTokensForDocument(params.textDocument.uri),
  );
  connection.languages.semanticTokens.onRange((params) =>
    semanticTokensForDocument(params.textDocument.uri, params.range),
  );

  connection.languages.diagnostics.on(async (params): Promise<DocumentDiagnosticReport> => {
    if (!clientCapabilities.pullDiagnostics) {
      return { kind: DocumentDiagnosticReportKind.Full, items: [] };
    }
    const uri = normalizeFileUri(params.textDocument.uri);
    const project = await projectForNearestConfig(uri);
    if (
      project === undefined ||
      (!project.inputs.includes(uri) && !reportedRelatedMembers.get(project.configPath)?.has(uri))
    ) {
      return { kind: DocumentDiagnosticReportKind.Full, items: [] };
    }
    return buildDocumentDiagnosticReport(project, uri);
  });

  connection.onFoldingRanges(async (params): Promise<FoldingRange[]> => {
    const project = await resolveProjectForDocument(params.textDocument.uri);
    if (project === undefined) {
      return [];
    }
    const artifacts = project.artifacts.document(params.textDocument.uri);
    if (artifacts === undefined) {
      return [];
    }
    return computeFoldingRanges(artifacts.document, project.artifacts.sources);
  });

  function documentChanged(uri: string): void {
    artifactsForDocument(uri)?.documentChanged(uri);
    publishForDocumentSafely(uri);
  }

  connection.onDidOpenTextDocument((event) => {
    const document = documents.open(event.textDocument);
    documentChanged(document.uri);
  });
  connection.onDidChangeTextDocument((event) => {
    const document = documents.change(event.textDocument, event.contentChanges);
    if (document !== undefined) documentChanged(document.uri);
  });
  connection.onDidCloseTextDocument((event) => {
    const document = documents.close(event.textDocument.uri);
    if (document === undefined) return;
    const uri = document.uri;
    const configPath = documentConfigPaths.get(canonicalFileIdentity(uri));
    artifactsForDocument(uri)?.documentClosed(uri);
    documentConfigPaths.delete(canonicalFileIdentity(uri));
    const project = currentProjectState(configPath);
    if (project === undefined) {
      if (!clientCapabilities.pullDiagnostics) sendDiagnostics({ uri, diagnostics: [] });
      return;
    }
    publishProjectMembers(project);
  });

  function currentProjectState(configPath: string | undefined): ProjectState | undefined {
    if (configPath === undefined) {
      return undefined;
    }
    const entry = managedProjects.get(configPath);
    if (entry === undefined || entry.status === 'failed') {
      return undefined;
    }
    return entry.status === 'loaded' ? entry.project : entry.lastGood;
  }

  connection.listen();

  function artifactsForDocument(uri: string): ProjectArtifacts | undefined {
    const configPath = documentConfigPaths.get(canonicalFileIdentity(uri));
    if (configPath === undefined) {
      return undefined;
    }
    const entry = managedProjects.get(configPath);
    if (entry?.status === 'loaded') {
      return entry.project.artifacts;
    }
    return entry?.status === 'loading' ? entry.lastGood?.artifacts : undefined;
  }

  return {
    dispose: () => connection.dispose(),
    getDocumentAst: (uri) => artifactsForDocument(uri)?.document(uri),
    // `| undefined` only because the uri may be unmanaged (closed, non-input,
    // or projectless); a managed document's project always yields a symbolTable.
    getProjectSymbolTable: (uri) => {
      const artifacts = artifactsForDocument(uri);
      if (artifacts?.document(uri) === undefined) {
        return undefined;
      }
      return artifacts.symbolTable();
    },
  };
}

function emptySemanticTokens(): SemanticTokens {
  return { data: [] };
}

function toDiagnostics(computed: readonly LspDiagnostic[]): Diagnostic[] {
  return computed.map((diagnostic) => ({
    range: diagnostic.range,
    message: diagnostic.message,
    code: diagnostic.code,
    severity: toLspSeverity(diagnostic.severity),
    source: 'prisma',
  }));
}

function toLspSeverity(severity: number): DiagnosticSeverity {
  switch (severity) {
    case ParseDiagnosticSeverity.Warning:
      return DiagnosticSeverity.Warning;
    case ParseDiagnosticSeverity.Information:
      return DiagnosticSeverity.Information;
    case ParseDiagnosticSeverity.Hint:
      return DiagnosticSeverity.Hint;
    default:
      return DiagnosticSeverity.Error;
  }
}

interface ResolvedClientCapabilities {
  readonly watchedFilesRegistration: boolean;
  readonly completionSnippets: boolean;
  readonly signatureLabelOffsets: boolean;
  readonly completionTriggerSuggestCommand: boolean;
  readonly completionTriggerParameterHintsCommand: boolean;
  readonly pullDiagnostics: boolean;
  readonly diagnosticsRefresh: boolean;
}

const noClientCapabilities: ResolvedClientCapabilities = {
  watchedFilesRegistration: false,
  completionSnippets: false,
  signatureLabelOffsets: false,
  completionTriggerSuggestCommand: false,
  completionTriggerParameterHintsCommand: false,
  pullDiagnostics: false,
  diagnosticsRefresh: false,
};

function resolveClientCapabilities(params: InitializeParams): ResolvedClientCapabilities {
  return {
    watchedFilesRegistration:
      params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true,
    completionSnippets:
      params.capabilities.textDocument?.completion?.completionItem?.snippetSupport === true,
    signatureLabelOffsets:
      params.capabilities.textDocument?.signatureHelp?.signatureInformation?.parameterInformation
        ?.labelOffsetSupport === true,
    completionTriggerSuggestCommand: supportsCompletionCommand(
      params.initializationOptions,
      'supportsTriggerSuggestCommand',
    ),
    completionTriggerParameterHintsCommand: supportsCompletionCommand(
      params.initializationOptions,
      'supportsTriggerParameterHintsCommand',
    ),
    pullDiagnostics: params.capabilities.textDocument?.diagnostic?.relatedDocumentSupport === true,
    diagnosticsRefresh: params.capabilities.workspace?.diagnostics?.refreshSupport === true,
  };
}

function supportsCompletionCommand(options: unknown, capability: string): boolean {
  if (typeof options !== 'object' || options === null || !('completion' in options)) return false;
  const completion = options.completion;
  return (
    typeof completion === 'object' &&
    completion !== null &&
    capability in completion &&
    Reflect.get(completion, capability) === true
  );
}

function resolveRootPath(params: InitializeParams): string {
  // Single-root scope: the first workspace folder wins; multi-root workspaces
  // are out of scope. `rootUri` / `rootPath` are the deprecated fallbacks.
  const workspaceFolder = params.workspaceFolders?.[0];
  if (workspaceFolder !== undefined) {
    return fileURLToPath(workspaceFolder.uri);
  }
  if (params.rootUri) {
    return fileURLToPath(params.rootUri);
  }
  if (params.rootPath) {
    return params.rootPath;
  }
  return process.cwd();
}

function filePathFromUri(uri: string): string | undefined {
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

function configPathsFromWatchedChanges(paths: readonly (string | undefined)[]): Set<string> {
  const configPaths = new Set<string>();
  for (const path of paths) {
    if (path?.endsWith(CONFIG_FILENAME)) {
      configPaths.add(path);
    }
  }
  return configPaths;
}
