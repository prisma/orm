import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { EMPTY_DATA_TYPES, renameLegacyDirective } from '@internal/psl-parser';
import { format, resolveFormatOptions } from '@internal/psl-parser/format';
import { isStructuredError } from '@internal/utils/structured-error';
import {
  type CompletionItem,
  type Connection,
  type Diagnostic,
  DiagnosticSeverity,
  DidChangeWatchedFilesNotification,
  DocumentDiagnosticReportKind,
  type FoldingRange,
  type FullDocumentDiagnosticReport,
  type Hover,
  type Location,
  type LocationLink,
  LSPErrorCodes,
  type Position,
  type PublishDiagnosticsParams,
  type Range,
  RegistrationRequest,
  type RelatedFullDocumentDiagnosticReport,
  ResponseError,
  type SemanticTokens,
  type SignatureHelp,
  UnregistrationRequest,
  type WorkspaceEdit,
} from 'vscode-languageserver';
import { classifyPslCompletionContext } from './completion-context';
import { providePslCompletionItems } from './completion-provider';
import { type ConfigResolution, resolveConfigInputs } from './config-resolution';
import { provideDefinition } from './definition';
import { type LspDiagnostic, ParseDiagnosticSeverity } from './diagnostic-mapping';
import type { DocumentStore } from './document-store';
import { computeFoldingRanges } from './folding-ranges';
import { providePslHover } from './hover';
import { ProjectArtifacts } from './project-artifacts';
import { provideReferences } from './references';
import { type PrepareRenameResult, providePrepareRename, provideRename } from './rename';
import {
  isWatcherCacheEligible,
  normalizeFileUri,
  resolveSchemaInputs,
  type SchemaInputConfig,
  toWatcherGlobPattern,
} from './schema-inputs';
import { buildSemanticTokens } from './semantic-tokens';
import { providePslSignatureHelp } from './signature-help';

interface ResolvedProject extends ConfigResolution {
  readonly artifacts: ProjectArtifacts;
}

type LoadState =
  | {
      readonly status: 'loading';
      readonly load: Promise<ResolvedProject>;
      readonly lastGood: ResolvedProject | undefined;
    }
  | { readonly status: 'loaded'; readonly data: ResolvedProject }
  | { readonly status: 'failed' };

interface ProjectOptions {
  readonly documents: DocumentStore;
  readonly connection: Connection;
  readonly pullDiagnostics: boolean;
  readonly watchedFilesRegistration: boolean;
  readonly nextSequence: () => number;
  readonly unmanage: (uri?: string) => void;
}

export const CONFIG_LOAD_FAILED_CODE = 'PRISMA_CONFIG_LOAD_FAILED';

export class Project {
  readonly configPath: string;
  readonly #options: ProjectOptions;
  #state: LoadState = { status: 'failed' };
  #membershipSequence = 0;
  #watcherGeneration = 0;
  #watcher: { readonly id: string; readonly schemaInputConfig: SchemaInputConfig } | undefined;
  #reportedMembers: ReadonlySet<string> = new Set();

  constructor(configPath: string, options: ProjectOptions) {
    this.configPath = configPath;
    this.#options = options;
  }

  get artifacts(): ProjectArtifacts | undefined {
    return this.#current()?.artifacts;
  }

  async publishForDocument(uri: string): Promise<void> {
    const data = await this.#resolveData().catch(() => undefined);
    if (data === undefined) return;
    const member = data.inputs.includes(uri);
    if (!member) this.#options.unmanage(uri);
    if (member || this.#reportedMembers.has(normalizeFileUri(uri))) {
      this.#publishMembers(data);
    }
  }

  async formatDocument(uri: string, source: string): Promise<string | undefined> {
    const data = await this.#resolveMember(uri);
    if (data === undefined) return undefined;
    try {
      return renameLegacyDirective(format(source, data.formatter, data.parserOptions));
    } catch {
      return undefined;
    }
  }

  async semanticTokens(uri: string, range?: Range): Promise<SemanticTokens> {
    const data = await this.#resolveMember(uri);
    const document = data?.artifacts.document(uri);
    if (data === undefined || document === undefined) return { data: [] };
    return buildSemanticTokens(
      {
        document: document.parse().document,
        sourceFile: document.sourceFile,
        binder: data.artifacts.binder(),
      },
      range,
    );
  }

  async completions(
    uri: string,
    position: Position,
    capabilities: {
      readonly completionSnippets: boolean;
      readonly completionTriggerSuggestCommand: boolean;
      readonly completionTriggerParameterHintsCommand: boolean;
    },
  ): Promise<CompletionItem[]> {
    const data = await this.#resolveMember(uri);
    const document = data?.artifacts.document(uri);
    if (data === undefined || document === undefined) return [];
    try {
      const context = classifyPslCompletionContext({
        document: document.parse().document,
        sourceFile: document.sourceFile,
        position,
      });
      return [
        ...providePslCompletionItems({
          context,
          sourceFile: document.sourceFile,
          candidates: {
            ...data.controlStack,
            symbolTable: data.artifacts.symbolTable(),
            binder: data.artifacts.binder(),
          },
          clientSupportsSnippets: capabilities.completionSnippets,
          clientSupportsTriggerSuggestCommand: capabilities.completionTriggerSuggestCommand,
          clientSupportsTriggerParameterHintsCommand:
            capabilities.completionTriggerParameterHintsCommand,
        }),
      ];
    } catch {
      return [];
    }
  }

  async signatureHelp(
    uri: string,
    position: Position,
    labelOffsets: boolean,
  ): Promise<SignatureHelp | null> {
    const data = await this.#resolveMember(uri);
    const document = data?.artifacts.document(uri);
    if (data === undefined || document === undefined) return null;
    try {
      return providePslSignatureHelp({
        clientSupportsLabelOffsets: labelOffsets,
        document: document.parse().document,
        sourceFile: document.sourceFile,
        position,
        candidates: {
          ...data.controlStack,
          symbolTable: data.artifacts.symbolTable(),
          binder: data.artifacts.binder(),
        },
      });
    } catch {
      return null;
    }
  }

  async hover(uri: string, position: Position): Promise<Hover | null> {
    const data = await this.#resolveMember(uri);
    const document = data?.artifacts.document(uri);
    if (data === undefined || document === undefined) return null;
    try {
      return providePslHover({
        document: document.parse().document,
        sourceFile: document.sourceFile,
        position,
        binder: data.artifacts.binder(),
        pslBlockDescriptors: data.controlStack.pslBlockDescriptors,
        dataTypes: data.controlStack.dataTypes ?? EMPTY_DATA_TYPES,
      });
    } catch {
      return null;
    }
  }

  async definition(
    uri: string,
    position: Position,
    linkSupport: boolean,
  ): Promise<LocationLink[] | Location[] | null> {
    const data = await this.#resolveMember(uri);
    const document = data?.artifacts.document(uri);
    if (data === undefined || document === undefined) return null;
    try {
      return provideDefinition({
        document: document.parse().document,
        sourceFile: document.sourceFile,
        position,
        sources: data.artifacts.sources,
        binder: data.artifacts.binder(),
        linkSupport,
      });
    } catch {
      return null;
    }
  }

  async references(
    uri: string,
    position: Position,
    includeDeclaration: boolean,
  ): Promise<Location[]> {
    const data = await this.#resolveMember(uri);
    const document = data?.artifacts.document(uri);
    if (data === undefined || document === undefined) return [];
    try {
      const documents = data.artifacts.documents().map((snapshot) => ({
        document: snapshot.parse().document,
        sourceFile: snapshot.sourceFile,
      }));
      return provideReferences({
        document: document.parse().document,
        sourceFile: document.sourceFile,
        position,
        documents,
        binder: data.artifacts.binder(),
        includeDeclaration,
      });
    } catch {
      return [];
    }
  }

  async prepareRename(uri: string, position: Position): Promise<PrepareRenameResult | null> {
    const data = await this.#resolveMember(uri);
    const document = data?.artifacts.document(uri);
    if (data === undefined || document === undefined) return null;
    try {
      const documents = data.artifacts.documents().map((snapshot) => ({
        document: snapshot.parse().document,
        sourceFile: snapshot.sourceFile,
      }));
      return providePrepareRename({
        document: document.parse().document,
        sourceFile: document.sourceFile,
        position,
        documents,
        binder: data.artifacts.binder(),
        symbolTable: data.artifacts.symbolTable(),
      });
    } catch {
      return null;
    }
  }

  async rename(uri: string, position: Position, newName: string): Promise<WorkspaceEdit | null> {
    const data = await this.#resolveMember(uri);
    const document = data?.artifacts.document(uri);
    if (data === undefined || document === undefined) return null;
    try {
      const documents = data.artifacts.documents().map((snapshot) => ({
        document: snapshot.parse().document,
        sourceFile: snapshot.sourceFile,
      }));
      return provideRename({
        document: document.parse().document,
        sourceFile: document.sourceFile,
        position,
        documents,
        binder: data.artifacts.binder(),
        ...data.controlStack,
        symbolTable: data.artifacts.symbolTable(),
        formatOptions: resolveFormatOptions(data.formatter),
        newName,
      });
    } catch (error) {
      if (error instanceof ResponseError && error.code === LSPErrorCodes.RequestFailed) throw error;
      return null;
    }
  }

  async foldingRanges(uri: string): Promise<FoldingRange[]> {
    const data = await this.#resolveMember(uri);
    const document = data?.artifacts.document(uri);
    if (data === undefined || document === undefined) return [];
    return computeFoldingRanges(document.parse().document, data.artifacts.sources);
  }

  #resolveData(): Promise<ResolvedProject> {
    const entry = this.#state;
    if (entry.status === 'failed') return this.#startLoad();
    return entry.status === 'loaded' ? Promise.resolve(entry.data) : entry.load;
  }

  async #resolveMember(uri: string): Promise<ResolvedProject | undefined> {
    const data = await this.#resolveData().catch(() => undefined);
    if (data === undefined || data.inputs.includes(uri)) return data;
    this.#options.unmanage(uri);
    return undefined;
  }

  async reload(): Promise<void> {
    const data = await this.#startLoad();
    this.#publishMembers(data);
  }

  publishMembers(): void {
    const data = this.#current();
    if (data !== undefined) this.#publishMembers(data);
  }

  documentChanged(uri: string): void {
    this.artifacts?.documentChanged(uri);
  }

  documentClosed(uri: string): void {
    this.artifacts?.documentClosed(uri);
  }

  async diagnosticReport(requestedUri: string): Promise<RelatedFullDocumentDiagnosticReport> {
    const project = await this.#resolveData().catch(() => undefined);
    const uri = normalizeFileUri(requestedUri);
    if (
      project === undefined ||
      (!project.inputs.includes(uri) && !this.#reportedMembers.has(uri))
    ) {
      return { kind: DocumentDiagnosticReportKind.Full, items: [] };
    }
    const projectSymbolDiagnostics = project.artifacts.symbolDiagnostics();
    const reportFor = (memberUri: string): FullDocumentDiagnosticReport => ({
      kind: DocumentDiagnosticReportKind.Full,
      items: toDiagnostics(project.artifacts.diagnostics(memberUri, projectSymbolDiagnostics)),
    });
    const members = new Set(Array.from(project.inputs.uris(), normalizeFileUri));
    const previous = this.#reportedMembers;
    const relatedDocuments: Record<string, FullDocumentDiagnosticReport> = {};
    for (const memberUri of new Set([...members, ...previous])) {
      if (memberUri === uri) continue;
      relatedDocuments[memberUri] = members.has(memberUri)
        ? reportFor(memberUri)
        : { kind: DocumentDiagnosticReportKind.Full, items: [] };
    }
    const report = reportFor(uri);
    if (previous.has(uri)) members.add(uri);
    this.#reportedMembers = members;
    return {
      ...report,
      ...(Object.keys(relatedDocuments).length > 0 ? { relatedDocuments } : {}),
    };
  }

  async refreshMembership(uri: string, sequence: number): Promise<boolean> {
    const entry = this.#state;
    if (entry.status === 'failed' || this.#membershipSequence > sequence) return false;
    this.#membershipSequence = sequence;
    this.documentChanged(uri);
    const project =
      entry.status === 'loaded' ? entry.data : await entry.load.catch(() => undefined);
    const isCurrent = (): boolean =>
      this.#state.status === 'loaded' &&
      this.#state.data === project &&
      this.#membershipSequence === sequence;
    if (project === undefined || !isCurrent()) return false;
    const nextInputs = await resolveSchemaInputs(project.schemaInputConfig, (candidate) =>
      this.#options.documents.text(candidate),
    );
    if (!isCurrent()) return false;
    project.artifacts.updateInputs(nextInputs);
    const updated = { ...project, inputs: nextInputs };
    this.#state = { status: 'loaded', data: updated };
    if (
      this.#watcher?.schemaInputConfig === project.schemaInputConfig &&
      isWatcherCacheEligible(project.schemaInputConfig)
    ) {
      this.#options.documents.setWatchCoverage(this.configPath, nextInputs.uris());
    }
    this.#publishMembers(updated);
    return true;
  }

  #current(): ResolvedProject | undefined {
    if (this.#state.status === 'failed') return undefined;
    return this.#state.status === 'loaded' ? this.#state.data : this.#state.lastGood;
  }

  #startLoad(): Promise<ResolvedProject> {
    this.#membershipSequence = this.#options.nextSequence();
    this.#clearWatcher();
    const existing = this.#state;
    const previousLoad = existing.status === 'loading' ? existing.load : undefined;
    const lastGood = this.#current();
    const load: Promise<ResolvedProject> = (previousLoad ?? Promise.resolve(undefined))
      .catch(() => undefined)
      .then(() => this.#load())
      .then(
        (data) => {
          if (this.#isCurrentLoad(load)) {
            this.#state = { status: 'loaded', data };
            this.#sendDiagnostics({
              uri: pathToFileURL(this.configPath).toString(),
              diagnostics: [],
            });
            void this.#registerWatcher(data);
          }
          return data;
        },
        (error: unknown) => {
          if (this.#isCurrentLoad(load)) {
            this.#publishConfigFailure(error);
            if (lastGood !== undefined) {
              this.#state = { status: 'loaded', data: lastGood };
              void this.#registerWatcher(lastGood);
              return lastGood;
            }
            this.#state = { status: 'failed' };
            this.#options.unmanage();
            this.#clearWatcher();
            this.#clearPublishedMembers();
          }
          throw error;
        },
      );
    this.#state = { status: 'loading', load, lastGood };
    return load;
  }

  #isCurrentLoad(load: Promise<ResolvedProject>): boolean {
    return this.#state.status === 'loading' && this.#state.load === load;
  }

  async #load(): Promise<ResolvedProject> {
    const resolution = await resolveConfigInputs(this.configPath, (uri) =>
      this.#options.documents.text(uri),
    );
    const artifacts = new ProjectArtifacts({
      controlStack: resolution.controlStack,
      inputs: resolution.inputs,
      readSnapshot: this.#options.documents.readSnapshot,
      onInterpretationError: (uri, error) => {
        const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
        this.#options.connection.console.error(`PSL interpretation failed for ${uri}: ${detail}`);
      },
      ...(resolution.interpretation === undefined
        ? {}
        : { interpretation: resolution.interpretation }),
      ...(resolution.parserOptions === undefined
        ? {}
        : { parserOptions: resolution.parserOptions }),
    });
    return { ...resolution, artifacts };
  }

  #clearWatcher(): number {
    const generation = ++this.#watcherGeneration;
    this.#options.documents.setWatchCoverage(this.configPath, []);
    if (this.#watcher !== undefined) this.#unregisterWatcher(this.#watcher.id);
    this.#watcher = undefined;
    return generation;
  }

  #unregisterWatcher(id: string): void {
    void this.#options.connection.sendRequest(UnregistrationRequest.type, {
      unregisterations: [{ id, method: DidChangeWatchedFilesNotification.type.method }],
    });
  }

  async #registerWatcher(project: ResolvedProject): Promise<void> {
    const generation = this.#clearWatcher();
    if (!this.#options.watchedFilesRegistration) return;
    const patterns = project.schemaInputConfig.contract?.source.inputs ?? [];
    if (patterns.length === 0) return;
    const id = randomUUID();
    const reply: unknown = await this.#options.connection.sendRequest(RegistrationRequest.type, {
      registrations: [
        {
          id,
          method: DidChangeWatchedFilesNotification.type.method,
          registerOptions: {
            watchers: patterns.map((pattern) => ({ globPattern: toWatcherGlobPattern(pattern) })),
          },
        },
      ],
    });
    // The guarded connection settles a failed request as undefined; a client's success reply is null.
    if (reply === undefined) return;
    if (this.#watcherGeneration !== generation) {
      this.#unregisterWatcher(id);
      return;
    }
    this.#watcher = { id, schemaInputConfig: project.schemaInputConfig };
    const current = this.#current();
    if (
      current?.schemaInputConfig === project.schemaInputConfig &&
      isWatcherCacheEligible(project.schemaInputConfig)
    ) {
      this.#options.documents.setWatchCoverage(this.configPath, current.inputs.uris());
    }
  }

  #publishMembers(project: ResolvedProject): void {
    if (this.#options.pullDiagnostics) return;
    const nextLedger = new Set<string>();
    const projectSymbolDiagnostics = project.artifacts.symbolDiagnostics();
    for (const candidateUri of project.inputs.uris()) {
      const uri = normalizeFileUri(candidateUri);
      this.#sendDiagnostics({
        uri,
        diagnostics: toDiagnostics(project.artifacts.diagnostics(uri, projectSymbolDiagnostics)),
      });
      nextLedger.add(uri);
    }
    for (const uri of this.#reportedMembers) {
      if (!nextLedger.has(uri)) this.#sendDiagnostics({ uri, diagnostics: [] });
    }
    this.#reportedMembers = nextLedger;
  }

  #clearPublishedMembers(): void {
    if (this.#options.pullDiagnostics) return;
    for (const uri of this.#reportedMembers) this.#sendDiagnostics({ uri, diagnostics: [] });
    this.#reportedMembers = new Set();
  }

  #publishConfigFailure(error: unknown): void {
    this.#sendDiagnostics({
      uri: pathToFileURL(this.configPath).toString(),
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

  #sendDiagnostics(params: PublishDiagnosticsParams): void {
    void this.#options.connection.sendDiagnostics({ ...params, uri: normalizeFileUri(params.uri) });
  }
}

/** A failed config load as the user reads it: the cause (`why`, or the message), then the fix when the error carries one. */
function configFailureMessage(error: unknown): string {
  if (!isStructuredError(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  return [error.why ?? error.message, ...(error.fix === undefined ? [] : [error.fix])].join('\n');
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
