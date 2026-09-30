import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { CliStructuredError } from '@internal/errors/control';
import { renameLegacyDirective } from '@internal/psl-parser';
import { format } from '@internal/psl-parser/format';
import {
  type CompletionItem,
  type Connection,
  type Diagnostic,
  DiagnosticSeverity,
  DidChangeWatchedFilesNotification,
  type Disposable,
  DocumentDiagnosticReportKind,
  type FoldingRange,
  type FullDocumentDiagnosticReport,
  type Position,
  type PublishDiagnosticsParams,
  type Range,
  type RelatedFullDocumentDiagnosticReport,
  type SemanticTokens,
  type SignatureHelp,
  UnregistrationRequest,
} from 'vscode-languageserver';
import { classifyPslCompletionContext } from './completion-context';
import { providePslCompletionItems } from './completion-provider';
import { type ConfigResolution, resolveConfigInputs } from './config-resolution';
import { type LspDiagnostic, ParseDiagnosticSeverity } from './diagnostic-mapping';
import type { DocumentStore } from './document-store';
import { computeFoldingRanges } from './folding-ranges';
import { requestWatcherRegistration } from './guarded-connection';
import { InternalWatcher } from './internal-watcher';
import { ProjectArtifacts } from './project-artifacts';
import {
  canonicalFileIdentity,
  isClientWatcherCompatible,
  normalizeFileUri,
  resolveSchemaInputs,
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
  readonly refreshDiagnostics: () => void;
  readonly registrationTimeoutMs?: number;
  readonly registerWatcher?: (patterns: readonly string[]) => Promise<Disposable | undefined>;
}

export const CONFIG_LOAD_FAILED_CODE = 'PRISMA_CONFIG_LOAD_FAILED';

export class Project {
  readonly configPath: string;
  readonly #options: ProjectOptions;
  #state: LoadState = { status: 'failed' };
  #membershipSequence = 0;
  #watcherGeneration = 0;
  #watcher: Disposable | undefined;
  #internalWatcher: InternalWatcher | undefined;
  readonly #retainedConfigWatchers = new Set<InternalWatcher>();
  readonly #closing = new Set<Promise<void>>();
  readonly #diskUris = new Set<string>();
  readonly #pendingPaths = new Set<string>();
  #reconcile = false;
  #batchTimer: ReturnType<typeof setTimeout> | undefined;
  #batch: Promise<void> | undefined;
  #cancelRegistration: (() => void) | undefined;
  #disposed = false;
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
      return renameLegacyDirective(format(source, data.formatter));
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
        symbolTable: data.artifacts.symbolTable(),
        scalarTypes: data.controlStack.scalarTypes,
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
        },
      });
    } catch {
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
    if (!this.#disposed && this.#current() === data) this.#publishMembers(data);
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
      !this.#disposed &&
      this.#state.status === 'loaded' &&
      this.#state.data === project &&
      this.#membershipSequence === sequence;
    if (project === undefined || !isCurrent()) return false;
    const nextInputs = await resolveSchemaInputs(project.schemaInputConfig, (candidate) =>
      this.#readText(candidate),
    );
    if (!isCurrent()) return false;
    project.artifacts.updateInputs(nextInputs);
    const updated = { ...project, inputs: nextInputs };
    this.#state = { status: 'loaded', data: updated };
    this.#publishMembers(updated);
    return true;
  }

  #current(): ResolvedProject | undefined {
    if (this.#state.status === 'failed') return undefined;
    return this.#state.status === 'loaded' ? this.#state.data : this.#state.lastGood;
  }

  #startLoad(): Promise<ResolvedProject> {
    this.#membershipSequence = this.#options.nextSequence();
    this.#clearWatcher(true);
    this.#invalidateSnapshots();
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
    return !this.#disposed && this.#state.status === 'loading' && this.#state.load === load;
  }

  async #load(): Promise<ResolvedProject> {
    const resolution = await resolveConfigInputs(this.configPath, (uri) => this.#readText(uri));
    const artifacts = new ProjectArtifacts({
      inputs: resolution.inputs,
      readSnapshot: (uri) => {
        this.#diskUris.add(uri);
        return this.#options.documents.readSnapshot(uri);
      },
      onInterpretationError: (uri, error) => {
        const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
        this.#options.connection.console.error(`PSL interpretation failed for ${uri}: ${detail}`);
      },
      ...(resolution.interpretation === undefined
        ? {}
        : { interpretation: resolution.interpretation }),
    });
    return { ...resolution, artifacts };
  }

  #readText(uri: string): string | undefined {
    this.#diskUris.add(uri);
    return this.#options.documents.text(uri);
  }

  #invalidateSnapshots(): void {
    for (const uri of this.#diskUris) {
      this.#options.documents.invalidate(uri);
      this.documentChanged(uri);
    }
  }

  #clearWatcher(retainConfigObservation = false): number {
    const generation = ++this.#watcherGeneration;
    this.#cancelRegistration?.();
    this.#cancelRegistration = undefined;
    this.#watcher?.dispose();
    this.#watcher = undefined;
    if (this.#batchTimer !== undefined) clearTimeout(this.#batchTimer);
    this.#batchTimer = undefined;
    this.#pendingPaths.clear();
    this.#reconcile = false;
    if (this.#internalWatcher !== undefined) {
      this.#retainedConfigWatchers.add(this.#internalWatcher);
      this.#internalWatcher = undefined;
    }
    if (!retainConfigObservation) this.#closeRetainedConfigWatchers();
    return generation;
  }

  #closeRetainedConfigWatchers(): void {
    for (const watcher of this.#retainedConfigWatchers) {
      const closing = watcher.close().catch((error: unknown) => this.#watchError(error));
      this.#closing.add(closing);
      void closing.finally(() => this.#closing.delete(closing));
    }
    this.#retainedConfigWatchers.clear();
  }

  #watchError(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.#options.connection.console.warn(
      `File watching failed for ${this.configPath}: ${detail}. External changes may be missed until project reload or server restart.`,
    );
  }

  async #registerWatcher(project: ResolvedProject): Promise<void> {
    const generation = this.#watcherGeneration;
    const current = (): boolean => !this.#disposed && this.#watcherGeneration === generation;
    const patterns = project.schemaInputConfig.contract?.source.inputs ?? [];
    if (
      this.#options.watchedFilesRegistration &&
      isClientWatcherCompatible(project.schemaInputConfig)
    ) {
      let accepting = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<undefined>((resolve) => {
        this.#cancelRegistration = () => {
          accepting = false;
          resolve(undefined);
        };
        timer = setTimeout(() => {
          accepting = false;
          resolve(undefined);
        }, this.#options.registrationTimeoutMs ?? 10_000);
        timer.unref();
      });
      try {
        const register =
          this.#options.registerWatcher ?? ((patterns) => this.#registerClientWatcher(patterns));
        const registration = register([...patterns, this.configPath]).then((disposable) => {
          if (!accepting || !current()) {
            disposable?.dispose();
            return undefined;
          }
          return disposable;
        });
        const disposable = await Promise.race([registration, deadline]);
        if (disposable !== undefined && current()) {
          this.#watcher = disposable;
          this.#closeRetainedConfigWatchers();
          this.#queueChanges([], true);
          return;
        }
        disposable?.dispose();
      } catch (error) {
        if (current()) this.#watchError(error);
      } finally {
        accepting = false;
        clearTimeout(timer);
        if (current()) this.#cancelRegistration = undefined;
      }
    }
    if (!current()) return;
    const watcher = new InternalWatcher(this.configPath, patterns, {
      onReady: () => {
        if (current()) {
          this.#closeRetainedConfigWatchers();
          this.#queueChanges([], true);
        }
      },
      onChange: (path) => {
        const uri = pathToFileURL(path).toString();
        if (current() || (this.#retainedConfigWatchers.has(watcher) && this.#isConfigUri(uri))) {
          this.#queueChanges([uri]);
        }
      },
      onError: (error) => {
        if (current() || this.#retainedConfigWatchers.has(watcher)) this.#watchError(error);
      },
    });
    this.#internalWatcher = watcher;
  }

  async #registerClientWatcher(patterns: readonly string[]): Promise<Disposable> {
    const id = randomUUID();
    const method = DidChangeWatchedFilesNotification.type.method;
    const result = await requestWatcherRegistration(this.#options.connection, {
      registrations: [
        {
          id,
          method,
          registerOptions: {
            watchers: patterns.map((pattern) => ({ globPattern: toWatcherGlobPattern(pattern) })),
          },
        },
      ],
    });
    if (!result.ok) throw result.error;
    return {
      dispose: () => {
        void this.#options.connection
          .sendRequest(UnregistrationRequest.type, {
            unregisterations: [{ id, method }],
          })
          .catch(() => undefined);
      },
    };
  }

  #isConfigUri(uri: string): boolean {
    return (
      canonicalFileIdentity(uri) ===
      canonicalFileIdentity(pathToFileURL(this.configPath).toString())
    );
  }

  filesChanged(uris: readonly string[]): void {
    if (uris.length > 0) this.#queueChanges(uris);
  }

  #queueChanges(uris: readonly string[], reconcile = false): void {
    if (this.#disposed) return;
    for (const uri of uris) this.#pendingPaths.add(uri);
    this.#reconcile ||= reconcile;
    if (this.#batch !== undefined) return;
    if (this.#batchTimer !== undefined) clearTimeout(this.#batchTimer);
    this.#batchTimer = setTimeout(() => {
      this.#batchTimer = undefined;
      const generation = this.#watcherGeneration;
      const paths = [...this.#pendingPaths];
      const reconcile = this.#reconcile;
      this.#pendingPaths.clear();
      this.#reconcile = false;
      this.#batch = this.#applyChanges(paths, reconcile, generation)
        .catch((error: unknown) => this.#watchError(error))
        .finally(() => {
          this.#batch = undefined;
          if (this.#pendingPaths.size > 0 || this.#reconcile) this.#queueChanges([]);
        });
    }, 50);
  }

  async #applyChanges(
    uris: readonly string[],
    reconcile: boolean,
    generation: number,
  ): Promise<void> {
    if (this.#disposed || generation !== this.#watcherGeneration) return;
    for (const uri of uris) this.#options.documents.invalidateTree(uri);
    if (reconcile) this.#invalidateSnapshots();
    if (uris.some((uri) => this.#isConfigUri(uri))) {
      await this.reload().catch(() => undefined);
      if (!this.#disposed) this.#options.refreshDiagnostics();
      return;
    }
    for (const uri of this.#diskUris) this.documentChanged(uri);
    if (
      await this.refreshMembership(
        uris[0] ?? pathToFileURL(this.configPath).toString(),
        this.#options.nextSequence(),
      )
    ) {
      if (!this.#disposed && generation === this.#watcherGeneration)
        this.#options.refreshDiagnostics();
    }
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#membershipSequence = this.#options.nextSequence();
    this.#clearWatcher();
    await Promise.all(this.#closing);
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
          message: CliStructuredError.is(error)
            ? (error.why ?? error.message)
            : error instanceof Error
              ? error.message
              : String(error),
          code: CONFIG_LOAD_FAILED_CODE,
          severity: DiagnosticSeverity.Error,
          source: 'prisma',
        },
      ],
    });
  }

  #sendDiagnostics(params: PublishDiagnosticsParams): void {
    if (this.#disposed) return;
    void this.#options.connection.sendDiagnostics({ ...params, uri: normalizeFileUri(params.uri) });
  }
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
