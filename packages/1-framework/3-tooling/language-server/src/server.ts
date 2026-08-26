import { fileURLToPath, pathToFileURL } from 'node:url';
import { findNearestConfigPathForFile } from '@internal/config-loader';
import { CliStructuredError } from '@internal/errors/control';
import type { SymbolTable } from '@internal/psl-parser';
import { type FormatOptions, format } from '@internal/psl-parser/format';
import { join } from 'pathe';
import {
  type CompletionItem,
  type Connection,
  type Diagnostic,
  DiagnosticSeverity,
  DidChangeWatchedFilesNotification,
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
  type SemanticTokens,
  TextDocumentSyncKind,
  TextDocuments,
  type TextEdit,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { classifyPslCompletionContext } from './completion-context';
import { providePslCompletionItems } from './completion-provider';
import {
  CONFIG_FILENAME,
  type ProjectInterpretation,
  resolveConfigInputs,
} from './config-resolution';
import { type LspDiagnostic, ParseDiagnosticSeverity } from './diagnostic-mapping';
import { computeFoldingRanges } from './folding-ranges';
import { guardedConnection } from './guarded-connection';
import type { PipelineInputs } from './pipeline';
import {
  createProjectArtifacts,
  type DocumentArtifacts,
  type ProjectArtifacts,
} from './project-artifacts';
import { isPrismaNextSchema } from './schema-directive';
import type { SchemaInputSet } from './schema-inputs';
import { buildSemanticTokens, semanticTokensLegend } from './semantic-tokens';

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
  readonly formatter?: FormatOptions;
  /**
   * Resolved once per config and refreshed by the config-watch path — never
   * rebuilt per document.
   */
  readonly controlStack: PipelineInputs;
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

export const CONFIG_LOAD_FAILED_CODE = 'PRISMA_NEXT_CONFIG_LOAD_FAILED';

const semanticTokenSourceLimit = 100_000;

export function createServer(connection: Connection): LanguageServer {
  // Guarded here rather than at each send site, so a send added later cannot
  // reach a departed client unguarded: the body below never holds the raw
  // connection.
  return createServerOn(guardedConnection(connection));
}

function createServerOn(connection: Connection): LanguageServer {
  const documents = new TextDocuments(TextDocument);
  const managedProjects = new Map<string, ManagedProject>();
  const documentConfigPaths = new Map<string, string>();
  let rootPath = process.cwd();
  let watchedConfigGlob = join(rootPath, '**', CONFIG_FILENAME);
  let clientCapabilities = noClientCapabilities;

  function sendDiagnostics(params: PublishDiagnosticsParams): void {
    void connection.sendDiagnostics(params);
  }

  function logWarn(message: string): void {
    connection.console.warn(message);
  }

  async function publish(uri: string): Promise<void> {
    const project = await resolveProjectForDocument(uri);
    if (project === undefined) {
      return;
    }
    const document = documents.get(uri);
    if (document === undefined) {
      documentConfigPaths.delete(uri);
      return;
    }
    const artifacts = project.artifacts.document(uri);
    if (artifacts === undefined) {
      sendDiagnostics({ uri, diagnostics: [] });
      return;
    }
    sendDiagnostics({ uri, diagnostics: combinedDiagnostics(artifacts) });
  }

  // The single diagnostics assembly — push and pull must serve the same
  // combined response, and interpretation runs only from here.
  function combinedDiagnostics(artifacts: DocumentArtifacts): Diagnostic[] {
    return toDiagnostics([...artifacts.diagnostics, ...artifacts.interpretDiagnostics()]);
  }

  /**
   * Project-scoped so a future multi-input symbol table can attach
   * `relatedDocuments` for cross-file effects.
   */
  function buildDocumentDiagnosticReport(
    project: ProjectState,
    uri: string,
  ): FullDocumentDiagnosticReport {
    const artifacts = project.artifacts.document(uri);
    return {
      kind: DocumentDiagnosticReportKind.Full,
      items: artifacts === undefined ? [] : combinedDiagnostics(artifacts),
    };
  }

  async function resolveProjectForDocument(uri: string): Promise<ProjectState | undefined> {
    const project = await projectForNearestConfig(uri);
    if (project === undefined || project.inputs.includes(uri)) {
      return project;
    }
    // Only the config's declared inputs are managed: a stray document beside
    // a config keeps no association, so reads and events never reach it — and
    // a project it alone caused to load is dropped again.
    documentConfigPaths.delete(uri);
    dropProjectWithoutManagedDocuments(project.configPath);
    return undefined;
  }

  async function projectForNearestConfig(uri: string): Promise<ProjectState | undefined> {
    const knownConfigPath = documentConfigPaths.get(uri);
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

    documentConfigPaths.set(uri, configPath);
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
            if (hasManagedDocuments(configPath)) {
              managedProjects.set(configPath, { status: 'loaded', project });
            } else {
              // A load that outlives the last association must not keep a
              // project entry alive.
              managedProjects.delete(configPath);
            }
            // Unconditional: clients keep per-server diagnostic state, so an
            // empty publish is harmless when no marker is outstanding.
            clearConfigFailure(configPath);
          }
          return project;
        },
        (error: unknown) => {
          // Same guard as above. All failure consequences live here — the
          // queue orders this handler strictly before any successor load.
          if (isCurrentLoad(configPath, load)) {
            if (!hasManagedDocuments(configPath)) {
              // No resurrection of the last-good project, no zombie marker.
              managedProjects.delete(configPath);
              clearConfigFailure(configPath);
            } else {
              publishConfigFailure(configPath, error);
              if (lastGood !== undefined) {
                managedProjects.set(configPath, { status: 'loaded', project: lastGood });
                return lastGood;
              }
              managedProjects.set(configPath, { status: 'failed' });
              unmanageDocuments(configPath);
            }
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
          source: 'prisma-next',
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
    const resolution = await resolveConfigInputs(configPath);
    // A fresh store per load: a config reload can change what a parse
    // produces (inputs, control stack), so later reads must derive from the
    // new resolution rather than anything computed under the old one.
    const artifacts = createProjectArtifacts({
      inputs: resolution.inputs,
      controlStack: resolution.controlStack,
      getText: (uri) => documents.get(uri)?.getText(),
      ...(resolution.interpretation === undefined
        ? {}
        : { interpretation: resolution.interpretation }),
    });
    const project: ProjectState = {
      configPath,
      inputs: resolution.inputs,
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
    for (const document of documents.all()) {
      if (documentConfigPaths.get(document.uri) === configPath) {
        documentConfigPaths.delete(document.uri);
      }
    }
  }

  async function republishOpenDocumentsForConfig(configPath: string): Promise<void> {
    for (const document of documents.all()) {
      const knownConfigPath = documentConfigPaths.get(document.uri);
      if (knownConfigPath === configPath) {
        if ((await resolveProjectForDocument(document.uri)) === undefined) {
          // The reload dropped a previously managed document; clear its markers.
          sendDiagnostics({ uri: document.uri, diagnostics: [] });
          continue;
        }
        await publish(document.uri);
        continue;
      }

      const filePath = filePathFromUri(document.uri);
      if (filePath === undefined) {
        continue;
      }
      const nearestConfigPath = await findNearestConfigPathForFile(filePath);
      if (nearestConfigPath === configPath) {
        documentConfigPaths.set(document.uri, configPath);
        await publish(document.uri);
      }
    }
  }

  function publishSafely(uri: string): void {
    void publish(uri).catch((error: unknown) => {
      connection.console.error(error instanceof Error ? error.message : String(error));
    });
  }

  async function formatDocument(uri: string): Promise<TextEdit[]> {
    const document = documents.get(uri);
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
      formatted = format(source, project.formatter);
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
    const document = documents.get(uri);
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
    const document = documents.get(uri);
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
          },
          clientSupportsSnippets: clientCapabilities.completionSnippets,
        }),
      ];
    } catch {
      return [];
    }
  }

  connection.onInitialize(async (params): Promise<InitializeResult> => {
    rootPath = resolveRootPath(params);
    watchedConfigGlob = join(rootPath, '**', CONFIG_FILENAME);
    clientCapabilities = resolveClientCapabilities(params);

    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        documentFormattingProvider: true,
        foldingRangeProvider: true,
        semanticTokensProvider: {
          legend: semanticTokensLegend,
          full: true,
          range: true,
        },
        completionProvider: { triggerCharacters: ['.'] },
        // Both flags reflect the current single-input implementation scope —
        // not a property of PSL. Once the project symbol table merges multiple
        // inputs, an edit in one file can change diagnostics in another and
        // these must flip alongside that work.
        ...(clientCapabilities.pullDiagnostics
          ? {
              diagnosticProvider: {
                interFileDependencies: false,
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
        'Client does not support dynamic file-watcher registration; Prisma Next config changes will not be picked up without a restart.',
      );
    }
  });

  connection.onDidChangeWatchedFiles(async (params) => {
    const changedConfigPaths = configPathsFromWatchedChanges(
      params.changes.map((change) => filePathFromUri(change.uri)),
    );
    for (const configPath of changedConfigPaths) {
      // Only live (or currently loading) projects are refreshed eagerly, so a
      // config change cannot resurrect a project dropped when its last input
      // closed; a config that newly gains an open input is still picked up
      // lazily below through per-document rediscovery.
      if (managedProjects.has(configPath)) {
        try {
          await refreshProject(configPath);
        } catch {
          // Failure consequences live in the load chain; nothing to do here.
          continue;
        }
      }
      if (!clientCapabilities.pullDiagnostics) {
        await republishOpenDocumentsForConfig(configPath);
      }
    }
    if (
      clientCapabilities.pullDiagnostics &&
      clientCapabilities.diagnosticsRefresh &&
      changedConfigPaths.size > 0
    ) {
      void connection.languages.diagnostics.refresh();
    }
  });

  connection.onDocumentFormatting((params) => formatDocument(params.textDocument.uri));
  connection.onCompletion((params) => completeDocument(params.textDocument.uri, params.position));

  connection.languages.semanticTokens.on((params) =>
    semanticTokensForDocument(params.textDocument.uri),
  );
  connection.languages.semanticTokens.onRange((params) =>
    semanticTokensForDocument(params.textDocument.uri, params.range),
  );

  connection.languages.diagnostics.on(async (params): Promise<DocumentDiagnosticReport> => {
    const project = await resolveProjectForDocument(params.textDocument.uri);
    if (project === undefined) {
      return { kind: DocumentDiagnosticReportKind.Full, items: [] };
    }
    return buildDocumentDiagnosticReport(project, params.textDocument.uri);
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
    return computeFoldingRanges(artifacts.document, artifacts.sourceFile);
  });

  documents.onDidOpen((event) => {
    artifactsForDocument(event.document.uri)?.documentChanged(event.document.uri);
    if (clientCapabilities.pullDiagnostics) {
      return;
    }
    publishSafely(event.document.uri);
  });
  documents.onDidChangeContent((event) => {
    artifactsForDocument(event.document.uri)?.documentChanged(event.document.uri);
    if (clientCapabilities.pullDiagnostics) {
      return;
    }
    publishSafely(event.document.uri);
  });
  documents.onDidClose((event) => {
    const uri = event.document.uri;
    const configPath = documentConfigPaths.get(uri);
    artifactsForDocument(uri)?.documentClosed(uri);
    documentConfigPaths.delete(uri);
    // A live project always has at least one open input; when the last one
    // closes the project is dropped, and a reopen re-resolves and reloads the
    // config from scratch.
    if (configPath !== undefined) {
      dropProjectWithoutManagedDocuments(configPath);
    }
    if (!clientCapabilities.pullDiagnostics) {
      sendDiagnostics({ uri, diagnostics: [] });
    }
  });

  documents.listen(connection);
  connection.listen();

  function artifactsForDocument(uri: string): ProjectArtifacts | undefined {
    const configPath = documentConfigPaths.get(uri);
    if (configPath === undefined) {
      return undefined;
    }
    const entry = managedProjects.get(configPath);
    return entry?.status === 'loaded' ? entry.project.artifacts : undefined;
  }

  function hasManagedDocuments(configPath: string): boolean {
    for (const managedConfigPath of documentConfigPaths.values()) {
      if (managedConfigPath === configPath) {
        return true;
      }
    }
    return false;
  }

  // Deletes only settled entries: an in-flight load settles through the
  // association check in startProjectLoad and cleans up after itself.
  function dropProjectWithoutManagedDocuments(configPath: string): void {
    if (hasManagedDocuments(configPath)) {
      return;
    }
    const entry = managedProjects.get(configPath);
    if (entry === undefined || entry.status === 'loading') {
      return;
    }
    managedProjects.delete(configPath);
    clearConfigFailure(configPath);
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
    source: 'prisma-next',
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
  readonly pullDiagnostics: boolean;
  readonly diagnosticsRefresh: boolean;
}

const noClientCapabilities: ResolvedClientCapabilities = {
  watchedFilesRegistration: false,
  completionSnippets: false,
  pullDiagnostics: false,
  diagnosticsRefresh: false,
};

function resolveClientCapabilities(params: InitializeParams): ResolvedClientCapabilities {
  return {
    watchedFilesRegistration:
      params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true,
    completionSnippets:
      params.capabilities.textDocument?.completion?.completionItem?.snippetSupport === true,
    pullDiagnostics: params.capabilities.textDocument?.diagnostic !== undefined,
    diagnosticsRefresh: params.capabilities.workspace?.diagnostics?.refreshSupport === true,
  };
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
