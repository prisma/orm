import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import type { ContractSourceContext } from '@internal/config/config-types';
import { errorUnexpected } from '@internal/errors/control';
import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import {
  assembleAuthoringContributions,
  assembleControlMutationDefaults,
} from '@internal/framework-components/control';
import {
  type AttributeSpecNamespace,
  blockAttribute,
  bool,
  buildSymbolTable,
  fieldAttribute,
  funcCall,
  identifier,
  int,
  list,
  modelAttribute,
  oneOf,
  optional,
  type SymbolTable,
  str,
} from '@internal/psl-parser';
import type { FormatOptions } from '@internal/psl-parser/format';
import type { PslInterpretCapable, PslInterpretInput } from '@internal/psl-parser/interpret';
import { type ParseDiagnostic, parse } from '@internal/psl-parser/syntax';
import { notOk, ok } from '@internal/utils/result';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ClientCapabilities,
  type CompletionItem,
  CompletionItemKind,
  type CompletionList,
  CompletionRequest,
  type ConnectionOptions,
  createConnection,
  type Diagnostic,
  DiagnosticRefreshRequest,
  DiagnosticSeverity,
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  type DocumentDiagnosticReport,
  DocumentDiagnosticReportKind,
  DocumentDiagnosticRequest,
  DocumentFormattingRequest,
  FileChangeType,
  type FoldingRange,
  FoldingRangeRequest,
  InitializedNotification,
  InitializeRequest,
  type InitializeResult,
  InsertTextFormat,
  LogMessageNotification,
  MarkupKind,
  MessageType,
  type Position,
  PublishDiagnosticsNotification,
  type Range,
  type RegistrationParams,
  RegistrationRequest,
  type SemanticTokens,
  ShutdownRequest,
  type SignatureHelpContext,
  SignatureHelpRequest,
  SignatureHelpTriggerKind,
  StreamMessageReader,
  StreamMessageWriter,
  TextDocumentSyncKind,
  type TextEdit,
} from 'vscode-languageserver/node';
import type { ConfigResolution } from '../src/config-resolution';
import { guardedConnection } from '../src/guarded-connection';
import type { DocumentArtifacts } from '../src/project-artifacts';
import { resolveSchemaInputs } from '../src/schema-inputs';
import { semanticTokensLegend } from '../src/semantic-tokens';
import { CONFIG_LOAD_FAILED_CODE, createServer } from '../src/server';

type ResolveInputs = (configPath: string) => Promise<ConfigResolution>;
type FindNearestConfigPathForFile = (filePath: string) => Promise<string | undefined>;

interface ConfigResolutionWithFormatter extends ConfigResolution {
  readonly formatter?: FormatOptions;
}

const configLoaderMock = vi.hoisted(() => ({
  findNearestConfigPathForFile: vi.fn<FindNearestConfigPathForFile>(),
}));
const configResolutionMock = vi.hoisted(() => ({
  resolveConfigInputs: vi.fn<ResolveInputs>(),
}));
const pipelineMock = vi.hoisted(() => ({
  runPipeline: vi.fn<typeof import('../src/pipeline')['runPipeline']>(),
}));

vi.mock('@internal/config-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@internal/config-loader')>();
  return {
    ...actual,
    findNearestConfigPathForFile: configLoaderMock.findNearestConfigPathForFile,
  };
});

vi.mock('../src/config-resolution', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config-resolution')>();
  return { ...actual, resolveConfigInputs: configResolutionMock.resolveConfigInputs };
});

// Pass-through spy on the parse seam so tests can count parses.
vi.mock('../src/pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/pipeline')>();
  pipelineMock.runPipeline.mockImplementation(actual.runPipeline);
  return { ...actual, runPipeline: pipelineMock.runPipeline };
});

const root = tmpdir();
const schemaPath = join(root, 'schema.psl');
const schemaUri = pathToFileURL(schemaPath).toString();
const configPath = join(root, 'prisma.config.ts');
const configUri = pathToFileURL(configPath).toString();
const unformattedPsl = '// use prisma-8\nmodel User {\nid Int\n}';
const formattedPsl = '// use prisma-8\nmodel User {\n  id Int\n}\n';

const scalarTypes = ['String', 'Int', 'Boolean', 'DateTime'] as const;
const nameSnippetPlaceholder = '$' + '{1:Name}';
const targetSnippetPlaceholder = '$' + '{1:target}';
const nameArgumentSnippetPlaceholder = '$' + '{2:name}';
const modeSnippetPlaceholder = '$' + '{1:mode}';

const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
  policy: {
    kind: 'pslBlock',
    keyword: 'policy',
    discriminator: 'fixture-policy',
    name: { required: true },
    parameters: {
      on: { kind: 'ref', refKind: 'model', scope: 'same-space' },
      where: { kind: 'value', codecId: 'fixture/text@1' },
      mode: { kind: 'option', values: ['permissive', 'restrictive'] },
    },
  },
};

const markerAttribute = fieldAttribute('marker', {
  documentation: 'Attaches a named marker to a target.',
  positional: [{ key: 'target', type: str(), documentation: 'The marker target.' }],
  named: {
    name: { type: str(), documentation: 'The marker name.' },
    priority: { type: optional(int()), documentation: 'The marker priority.' },
  },
});
const rlsAttribute = modelAttribute('rls', {
  documentation: 'Configures row-level security for this model.',
  named: {
    mode: { type: str(), documentation: 'The security mode.' },
    enabled: { type: optional(str()), documentation: 'The security enablement setting.' },
  },
});
const completionAuthoringContributions = assembleAuthoringContributions([
  {
    id: 'completion-family',
    authoring: {
      attributeSpecs: {
        field: { marker: () => markerAttribute },
        model: {},
      },
    },
  },
  {
    id: 'completion-target',
    authoring: {
      modelAttributes: {
        security: {
          rls: {
            kind: 'modelAttribute',
            attribute: 'rls',
            spec: () => rlsAttribute,
            lower: () => undefined,
          },
        },
      },
    },
  },
]);
const completionInterpretationContext = {
  authoringContributions: completionAuthoringContributions,
  controlMutationDefaults: assembleControlMutationDefaults([]),
} as unknown as ContractSourceContext;

function resolutionForInputs(
  inputs: readonly string[],
  formatter?: FormatOptions,
  descriptors: AuthoringPslBlockDescriptorNamespace = {},
): ConfigResolutionWithFormatter {
  const resolution = {
    inputs: resolveSchemaInputs({
      contract: { source: { format: 'psl', inputs } },
    }),
    controlStack: { scalarTypes: [...scalarTypes], pslBlockDescriptors: descriptors },
  };
  return formatter === undefined ? resolution : { ...resolution, formatter };
}

function emptyResolution(): ConfigResolution {
  return {
    inputs: resolveSchemaInputs({}),
    controlStack: { scalarTypes: [...scalarTypes], pslBlockDescriptors: {} },
  };
}

const resolveToSchema: ResolveInputs = async () => resolutionForInputs([schemaPath]);
const resolveToSchemaWithPslBlockDescriptors: ResolveInputs = async () =>
  resolutionForInputs([schemaPath], undefined, pslBlockDescriptors);
const completionInterpretationSource = {
  format: 'psl',
  inputs: [schemaPath],
  load: async () => ok({} as never),
  interpret: () => ok({} as never),
} as unknown as PslInterpretCapable;

const resolveToSchemaWithAttributeContributions: ResolveInputs = async () => {
  const resolution = resolutionForInputs([schemaPath], undefined, pslBlockDescriptors);
  return {
    ...resolution,
    controlStack: {
      ...resolution.controlStack,
      authoringContributions: completionAuthoringContributions,
      controlMutationDefaults: completionInterpretationContext.controlMutationDefaults,
    },
    interpretation: {
      source: completionInterpretationSource,
      context: completionInterpretationContext,
    },
  };
};

async function recursiveCompletionResolution(): Promise<ConfigResolution> {
  const sql = (await import(
    new URL(
      '../../../../2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts',
      import.meta.url,
    ).href
  )) as { sqlAttributeSpecs: AttributeSpecNamespace };
  const signature = {
    documentation: 'Selects a value and a set of flags.',
    named: {
      value: {
        type: funcCall('choose', {
          documentation: 'Chooses between the first and second modes.',
          named: {
            mode: {
              type: oneOf(
                identifier('First', {
                  documentation: 'An accepted identifier in this test grammar.',
                }),
                identifier('Second', {
                  documentation: 'An accepted identifier in this test grammar.',
                }),
              ),
              documentation: 'The selected mode.',
            },
            enabled: { type: optional(bool()), documentation: 'Whether the choice is enabled.' },
          },
        }),
        documentation: 'The configured choice.',
      },
      flags: { type: list(bool()), documentation: 'The boolean flags accompanying the choice.' },
    },
  };
  const probeField = fieldAttribute('probe', signature);
  const probeModel = modelAttribute('probe', signature);
  const probeBlock = blockAttribute('probe', signature);
  const descriptors: AuthoringPslBlockDescriptorNamespace = {
    policy: {
      kind: 'pslBlock',
      keyword: 'policy',
      discriminator: 'completion-policy',
      name: { required: true },
      parameters: {},
      attributes: { probe: () => probeBlock },
    },
  };
  const resolution = resolutionForInputs([schemaPath], undefined, descriptors);
  return {
    ...resolution,
    controlStack: {
      ...resolution.controlStack,
      authoringContributions: assembleAuthoringContributions([
        { id: 'sql-family', authoring: { attributeSpecs: sql.sqlAttributeSpecs } },
        {
          id: 'contributed-attributes',
          authoring: {
            attributeSpecs: { field: { probe: () => probeField }, model: {} },
            modelAttributes: {
              completion: {
                probe: {
                  kind: 'modelAttribute',
                  attribute: 'probe',
                  spec: () => probeModel,
                  lower: () => undefined,
                },
              },
            },
          },
        },
      ]),
      controlMutationDefaults: assembleControlMutationDefaults([]),
    },
    interpretation: {
      context: completionInterpretationContext,
      source: {
        ...completionInterpretationSource,
        interpret: () =>
          notOk({
            summary: 'Incomplete authoring buffer',
            diagnostics: [
              {
                code: 'PSL_TEST_INTERPRETATION_FAILED',
                message: 'Incomplete authoring buffer',
                sourceId: schemaUri,
                span: {
                  start: { offset: 0, line: 1, column: 1 },
                  end: { offset: 1, line: 1, column: 2 },
                },
              },
            ],
          }),
      },
    },
  };
}

function resolveToSchemaWithFormatter(formatter: FormatOptions): ResolveInputs {
  return async () => resolutionForInputs([schemaPath], formatter);
}

// Mirrors the server's LSP framing of a `ParseDiagnostic` (see `publish`):
// the symbol-table tier is published with the same shape as the parse tier.
function toPublishedDiagnostics(diagnostics: readonly ParseDiagnostic[]): Diagnostic[] {
  return diagnostics.map((diagnostic) => ({
    range: diagnostic.range,
    message: diagnostic.message,
    code: diagnostic.code,
    severity: DiagnosticSeverity.Error,
    source: 'prisma',
  }));
}

function parseAndSymbolTableDiagnostics(source: string): {
  readonly parseDiagnostics: readonly ParseDiagnostic[];
  readonly symbolTableDiagnostics: readonly ParseDiagnostic[];
} {
  const {
    document,
    sources,
    diagnostics: parseDiagnostics,
  } = parse(source, 'language-server-test.psl');
  const { diagnostics: symbolTableDiagnostics } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  return { parseDiagnostics, symbolTableDiagnostics };
}

const watchedFilesCapabilities: ClientCapabilities = {
  workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
};

const snippetCompletionCapabilities: ClientCapabilities = {
  textDocument: { completion: { completionItem: { snippetSupport: true } } },
};

const pullDiagnosticsCapabilities: ClientCapabilities = {
  textDocument: { diagnostic: {} },
};

const pullDiagnosticsWithRefreshCapabilities: ClientCapabilities = {
  textDocument: { diagnostic: {} },
  workspace: { diagnostics: { refreshSupport: true } },
};

interface Harness {
  readonly client: ReturnType<typeof createConnection>;
  readonly initialize: (initializationOptions?: unknown) => Promise<InitializeResult>;
  readonly waitForDiagnostics: (uri: string) => Promise<readonly Diagnostic[]>;
  readonly waitForDiagnosticsMatching: (
    uri: string,
    predicate: (diagnostics: readonly Diagnostic[]) => boolean,
  ) => Promise<readonly Diagnostic[]>;
  readonly waitForDiagnosticsCount: (uri: string, count: number) => Promise<void>;
  readonly registrations: RegistrationParams[];
  readonly waitForWatchedFilesRegistration: (timeoutMs: number) => Promise<void>;
  readonly waitForWarning: (predicate: (message: string) => boolean) => Promise<string>;
  readonly latestDiagnostics: (uri: string) => readonly Diagnostic[] | undefined;
  readonly publishCount: (uri: string) => number;
  readonly nonEmptyPublishCount: (uri: string) => number;
  readonly diagnosticRefreshCount: () => number;
  readonly waitForDiagnosticRefresh: () => Promise<void>;
  readonly notifyConfigChanged: (uri?: string) => void;
  readonly getDocumentAst: (uri: string) => DocumentArtifacts | undefined;
  readonly getProjectSymbolTable: (uri: string) => SymbolTable | undefined;
  dispose: () => Promise<void>;
  disconnect: () => void;
}

function startHarness(
  resolveInputs: ResolveInputs,
  capabilities: ClientCapabilities = {},
  findNearestConfigPathForFile: FindNearestConfigPathForFile = async () => configPath,
): Harness {
  configResolutionMock.resolveConfigInputs.mockImplementation(resolveInputs);
  configLoaderMock.findNearestConfigPathForFile.mockImplementation(findNearestConfigPathForFile);
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  const pendingMessages = new Set<Promise<void>>();
  const connectionOptions: ConnectionOptions = {
    messageStrategy: {
      handleMessage: (message, next) => {
        const preceding = [...pendingMessages];
        const task = Promise.resolve()
          .then(async () => {
            if ('method' in message && message.method === ShutdownRequest.type.method) {
              await Promise.all(preceding);
            }
            await next(message);
          })
          .finally(() => pendingMessages.delete(task));
        pendingMessages.add(task);
        return task;
      },
    },
  };

  const serverConnection = createConnection(
    new StreamMessageReader(clientToServer),
    new StreamMessageWriter(serverToClient),
    connectionOptions,
  );
  const server = createServer(serverConnection);

  // Guarded like the server: a client send whose write fails after dispose
  // must not become an unhandled rejection in the test process.
  const client = guardedConnection(
    createConnection(
      new StreamMessageReader(serverToClient),
      new StreamMessageWriter(clientToServer),
      connectionOptions,
    ),
  );

  const pending = new Map<string, (diagnostics: readonly Diagnostic[]) => void>();
  const latest = new Map<string, readonly Diagnostic[]>();
  const publishCounts = new Map<string, number>();
  const nonEmptyPublishCounts = new Map<string, number>();
  interface PredicateWaiter {
    readonly predicate: (diagnostics: readonly Diagnostic[]) => boolean;
    readonly resolve: (diagnostics: readonly Diagnostic[]) => void;
  }
  const predicateWaiters = new Map<string, PredicateWaiter[]>();
  interface CountWaiter {
    readonly count: number;
    readonly resolve: () => void;
  }
  const countWaiters = new Map<string, CountWaiter[]>();
  client.onNotification(PublishDiagnosticsNotification.type, (params) => {
    latest.set(params.uri, params.diagnostics);
    const publishCount = (publishCounts.get(params.uri) ?? 0) + 1;
    publishCounts.set(params.uri, publishCount);
    if (params.diagnostics.length > 0) {
      nonEmptyPublishCounts.set(params.uri, (nonEmptyPublishCounts.get(params.uri) ?? 0) + 1);
    }
    pending.get(params.uri)?.(params.diagnostics);
    const countQueue = countWaiters.get(params.uri);
    if (countQueue) {
      const remaining = countQueue.filter((waiter) => {
        if (publishCount >= waiter.count) {
          waiter.resolve();
          return false;
        }
        return true;
      });
      countWaiters.set(params.uri, remaining);
    }
    const queue = predicateWaiters.get(params.uri);
    if (queue) {
      const remaining = queue.filter((waiter) => {
        if (waiter.predicate(params.diagnostics)) {
          waiter.resolve(params.diagnostics);
          return false;
        }
        return true;
      });
      predicateWaiters.set(params.uri, remaining);
    }
  });

  const registrations: RegistrationParams[] = [];
  const isWatchedFilesRegistration = (params: RegistrationParams) =>
    params.registrations.some(
      (registration) => registration.method === 'workspace/didChangeWatchedFiles',
    );
  interface RegistrationWaiter {
    readonly resolve: () => void;
  }
  const registrationWaiters: RegistrationWaiter[] = [];
  client.onRequest(RegistrationRequest.type, (params) => {
    registrations.push(params);
    if (!isWatchedFilesRegistration(params)) {
      return;
    }
    for (const waiter of registrationWaiters.splice(0)) {
      waiter.resolve();
    }
  });

  let diagnosticRefreshes = 0;
  const diagnosticRefreshWaiters: (() => void)[] = [];
  client.onRequest(DiagnosticRefreshRequest.type, () => {
    diagnosticRefreshes += 1;
    for (const waiter of diagnosticRefreshWaiters.splice(0)) {
      waiter();
    }
  });

  const warnings: string[] = [];
  interface WarningWaiter {
    readonly predicate: (message: string) => boolean;
    readonly resolve: (message: string) => void;
  }
  const warningWaiters: WarningWaiter[] = [];
  client.onNotification(LogMessageNotification.type, (params) => {
    if (params.type !== MessageType.Warning) {
      return;
    }
    warnings.push(params.message);
    for (const waiter of warningWaiters.splice(0)) {
      if (waiter.predicate(params.message)) {
        waiter.resolve(params.message);
      } else {
        warningWaiters.push(waiter);
      }
    }
  });
  client.listen();

  function disconnect(): void {
    server.dispose();
    client.dispose();
    clientToServer.end();
    serverToClient.end();
  }

  return {
    client,
    registrations,
    waitForWatchedFilesRegistration: (timeoutMs) =>
      new Promise((resolve, reject) => {
        if (registrations.some(isWatchedFilesRegistration)) {
          resolve();
          return;
        }
        let timeout: ReturnType<typeof setTimeout>;
        const waiter = {
          resolve: () => {
            clearTimeout(timeout);
            resolve();
          },
        };
        timeout = setTimeout(() => {
          const index = registrationWaiters.indexOf(waiter);
          if (index !== -1) {
            registrationWaiters.splice(index, 1);
          }
          reject(
            new Error(
              `No workspace/didChangeWatchedFiles registration observed within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
        registrationWaiters.push(waiter);
      }),
    waitForWarning: (predicate) =>
      new Promise((resolve) => {
        const existing = warnings.find((message) => predicate(message));
        if (existing !== undefined) {
          resolve(existing);
          return;
        }
        warningWaiters.push({ predicate, resolve });
      }),
    latestDiagnostics: (uri) => latest.get(uri),
    publishCount: (uri) => publishCounts.get(uri) ?? 0,
    nonEmptyPublishCount: (uri) => nonEmptyPublishCounts.get(uri) ?? 0,
    diagnosticRefreshCount: () => diagnosticRefreshes,
    waitForDiagnosticRefresh: () =>
      new Promise((resolve) => {
        if (diagnosticRefreshes > 0) {
          resolve();
          return;
        }
        diagnosticRefreshWaiters.push(resolve);
      }),
    initialize: async (initializationOptions) => {
      const result = await client.sendRequest(InitializeRequest.type, {
        initializationOptions,
        processId: process.pid,
        rootUri: pathToFileURL(root).toString(),
        capabilities,
        workspaceFolders: null,
      });
      client.sendNotification(InitializedNotification.type, {});
      return result;
    },
    waitForDiagnostics: (uri) =>
      new Promise((resolve) => {
        const existing = latest.get(uri);
        if (existing) {
          resolve(existing);
          return;
        }
        pending.set(uri, resolve);
      }),
    waitForDiagnosticsMatching: (uri, predicate) =>
      new Promise((resolve) => {
        const queue = predicateWaiters.get(uri) ?? [];
        queue.push({ predicate, resolve });
        predicateWaiters.set(uri, queue);
      }),
    waitForDiagnosticsCount: (uri, count) =>
      new Promise((resolve) => {
        if ((publishCounts.get(uri) ?? 0) >= count) {
          resolve();
          return;
        }
        const queue = countWaiters.get(uri) ?? [];
        queue.push({ count, resolve });
        countWaiters.set(uri, queue);
      }),
    notifyConfigChanged: (uri = configUri) => {
      client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: [{ uri, type: FileChangeType.Changed }],
      });
    },
    getDocumentAst: (uri) => server.getDocumentAst(uri),
    getProjectSymbolTable: (uri) => server.getProjectSymbolTable(uri),
    dispose: async () => {
      await client.sendRequest(ShutdownRequest.type);
      while (pendingMessages.size > 0) {
        await Promise.all(pendingMessages);
      }
      disconnect();
    },
    disconnect,
  };
}

function openDocument(harness: Harness, uri: string, text: string, version = 1): void {
  harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri, languageId: 'prisma', version, text },
  });
}

function closeDocument(harness: Harness, uri: string): void {
  harness.client.sendNotification(DidCloseTextDocumentNotification.type, {
    textDocument: { uri },
  });
}

function requestFormatting(harness: Harness, uri: string): Promise<TextEdit[] | null> {
  return harness.client.sendRequest(DocumentFormattingRequest.type, {
    textDocument: { uri },
    options: { tabSize: 2, insertSpaces: true },
  });
}

function requestSemanticTokens(harness: Harness, uri: string): Promise<SemanticTokens | null> {
  return harness.client.sendRequest('textDocument/semanticTokens/full', {
    textDocument: { uri },
  });
}

function requestFoldingRanges(harness: Harness, uri: string): Promise<FoldingRange[] | null> {
  return harness.client.sendRequest(FoldingRangeRequest.type, {
    textDocument: { uri },
  });
}

function requestPullDiagnostics(harness: Harness, uri: string): Promise<DocumentDiagnosticReport> {
  return harness.client.sendRequest(DocumentDiagnosticRequest.type, {
    textDocument: { uri },
  });
}

function fullReportItems(report: DocumentDiagnosticReport): readonly Diagnostic[] {
  return report.kind === DocumentDiagnosticReportKind.Full ? report.items : [];
}

// Lets any stray asynchronous publish flush before asserting its absence.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

function requestSemanticTokensRange(
  harness: Harness,
  uri: string,
  range: Range,
): Promise<SemanticTokens | null> {
  return harness.client.sendRequest('textDocument/semanticTokens/range', {
    textDocument: { uri },
    range,
  });
}

function semanticTokenChunks(tokens: SemanticTokens | null): readonly (readonly number[])[] {
  const data = tokens?.data ?? [];
  const chunks: number[][] = [];
  for (let index = 0; index < data.length; index += 5) {
    chunks.push(data.slice(index, index + 5));
  }
  return chunks;
}

function requestCompletion(
  harness: Harness,
  uri: string,
  position: Position,
): Promise<CompletionItem[] | CompletionList | null> {
  return harness.client.sendRequest(CompletionRequest.type, {
    textDocument: { uri },
    position,
  });
}

function requestSignatureHelp(
  harness: Harness,
  uri: string,
  position: Position,
  context?: SignatureHelpContext,
) {
  return harness.client.sendRequest(SignatureHelpRequest.type, {
    textDocument: { uri },
    position,
    ...(context === undefined ? {} : { context }),
  });
}

function completionItems(
  result: CompletionItem[] | CompletionList | null,
): readonly CompletionItem[] {
  if (result === null) {
    return [];
  }
  return Array.isArray(result) ? result : result.items;
}

function sourceWithCursor(markedSource: string): {
  readonly source: string;
  readonly position: Position;
} {
  const cursorOffset = markedSource.indexOf('|');
  if (cursorOffset < 0) {
    throw new Error('Missing cursor marker');
  }
  const prefix = markedSource.slice(0, cursorOffset);
  const source = `${prefix}${markedSource.slice(cursorOffset + 1)}`;
  const lines = prefix.split('\n');
  return {
    source,
    position: { line: lines.length - 1, character: (lines[lines.length - 1] ?? '').length },
  };
}

function applyCompletionItem(source: string, item: CompletionItem): string {
  const edit = item.textEdit;
  if (edit === undefined || !('range' in edit)) {
    throw new Error('Expected a range text edit');
  }
  return applyTextEdit(source, edit);
}

function applyTextEdit(source: string, edit: TextEdit): string {
  const { document, sources } = parse(source, 'language-server-test.psl');
  const sourceFile = sources.sourceFileFor(document.syntax);
  const start = sourceFile.offsetAt(edit.range.start);
  const end = sourceFile.offsetAt(edit.range.end);
  return `${source.slice(0, start)}${edit.newText}${source.slice(end)}`;
}

function completionItemByLabel(items: readonly CompletionItem[], label: string): CompletionItem {
  const item = items.find((candidate) => candidate.label === label);
  if (item === undefined) {
    throw new Error(`Expected completion item "${label}"`);
  }
  return item;
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function deferredSettleable<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
  configResolutionMock.resolveConfigInputs.mockReset();
  configLoaderMock.findNearestConfigPathForFile.mockReset();
  pipelineMock.runPipeline.mockClear();
});

describe('language server', { timeout: timeouts.databaseOperation }, () => {
  it('publishes once per open and edit, using the opened URI across equivalent lifecycle notifications', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const alias = schemaUri.replace('schema.psl', '%73chema.psl');
    openDocument(harness, alias, unformattedPsl);
    await harness.waitForDiagnostics(alias);
    await settle();
    expect(harness.publishCount(alias)).toBe(1);
    expect(harness.publishCount(schemaUri)).toBe(0);
    const first = harness.getDocumentAst(schemaUri)!;
    expect(first).toBe(harness.getDocumentAst(alias));
    expect(first.sourceFile.filename).toBe(alias);
    expect(await requestFormatting(harness, schemaUri)).toEqual([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 3, character: 1 } },
        newText: formattedPsl,
      },
    ]);
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [
        {
          range: { start: { line: 1, character: 6 }, end: { line: 1, character: 10 } },
          text: 'Post',
        },
      ],
    });
    await harness.waitForDiagnosticsCount(alias, 2);
    await settle();
    expect(harness.publishCount(alias)).toBe(2);
    expect(harness.publishCount(schemaUri)).toBe(0);
    expect(harness.getDocumentAst(schemaUri)).not.toBe(first);
    expect(Object.keys(harness.getProjectSymbolTable(schemaUri)!.topLevel.models)).toEqual([
      'Post',
    ]);
    expect(configLoaderMock.findNearestConfigPathForFile).toHaveBeenCalledTimes(1);
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 3 },
      contentChanges: [],
    });
    await requestFormatting(harness, alias);
    await settle();
    expect(harness.publishCount(alias)).toBe(2);
    closeDocument(harness, schemaUri);
    await harness.waitForDiagnosticsCount(alias, 3);
    expect(harness.getDocumentAst(alias)).toBeUndefined();
    expect(harness.getProjectSymbolTable(schemaUri)).toBeUndefined();
    openDocument(harness, schemaUri, unformattedPsl);
    await harness.waitForDiagnostics(schemaUri);
    expect(harness.getDocumentAst(alias)?.sourceFile.filename).toBe(schemaUri);
    expect(Object.keys(harness.getProjectSymbolTable(alias)!.topLevel.models)).toEqual(['User']);
    expect(configResolutionMock.resolveConfigInputs).toHaveBeenCalledTimes(2);
  });

  it('replaces simultaneous alias opens and clears the superseded URI', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const alias = schemaUri.replace('schema.psl', '%73chema.psl');
    openDocument(harness, alias, duplicateModelSource);
    expect((await harness.waitForDiagnostics(alias)).length).toBeGreaterThan(0);
    openDocument(harness, schemaUri, unformattedPsl);
    await harness.waitForDiagnostics(schemaUri);
    expect(harness.latestDiagnostics(alias)).toEqual([]);
    expect(harness.getDocumentAst(alias)?.sourceFile.filename).toBe(schemaUri);
    expect(harness.getDocumentAst(alias)).toBe(harness.getDocumentAst(schemaUri));
    closeDocument(harness, alias);
    await harness.waitForDiagnosticsCount(schemaUri, 2);
    expect(harness.getDocumentAst(schemaUri)).toBeUndefined();
    expect(await requestFormatting(harness, schemaUri)).toEqual([]);
    expect(configResolutionMock.resolveConfigInputs).toHaveBeenCalledTimes(1);
  });

  it('reads aliases from the current buffer for pull diagnostics and editor features', async () => {
    harness = startHarness(resolveToSchema, pullDiagnosticsCapabilities);
    await harness.initialize();
    const alias = schemaUri.replace('schema.psl', '%73chema.psl');
    openDocument(harness, alias, unformattedPsl);
    expect(fullReportItems(await requestPullDiagnostics(harness, schemaUri))).toEqual([]);
    expect(harness.getDocumentAst(schemaUri)?.sourceFile.filename).toBe(alias);
    const updated = '// use prisma-8\r\nmodel Post {\r\n  id Int\r\n}\r\nmodel Post {}';
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: updated }],
    });
    const diagnostics = fullReportItems(await requestPullDiagnostics(harness, schemaUri));
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(fullReportItems(await requestPullDiagnostics(harness, alias))).toEqual(diagnostics);
    expect(await requestFoldingRanges(harness, schemaUri)).toEqual(
      await requestFoldingRanges(harness, alias),
    );
    expect(await requestSemanticTokens(harness, schemaUri)).toEqual(
      await requestSemanticTokens(harness, alias),
    );
    const position = { line: 2, character: 5 };
    const completions = completionItems(await requestCompletion(harness, schemaUri, position));
    expect(completions.map(({ label }) => label)).toContain('Post');
    expect(completions).toEqual(completionItems(await requestCompletion(harness, alias, position)));
    expect(pipelineMock.runPipeline).toHaveBeenLastCalledWith(alias, updated, expect.any(Object));
    expect(configLoaderMock.findNearestConfigPathForFile).toHaveBeenCalledTimes(1);
    expect(harness.publishCount(schemaUri)).toBe(0);
    expect(harness.publishCount(alias)).toBe(0);
  });

  it('ignores changes and closes for unopened documents', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: unformattedPsl }],
    });
    closeDocument(harness, schemaUri);
    expect(await requestFormatting(harness, schemaUri)).toEqual([]);
    await settle();
    expect(harness.publishCount(schemaUri)).toBe(0);
    expect(configResolutionMock.resolveConfigInputs).not.toHaveBeenCalled();
  });

  it('answers initialize and advertises text-document features plus completion support', async () => {
    harness = startHarness(resolveToSchema);
    const result = await harness.initialize();
    expect(result.capabilities.textDocumentSync).toEqual({
      openClose: true,
      change: TextDocumentSyncKind.Incremental,
    });
    expect(result.capabilities.documentFormattingProvider).toBe(true);
    expect(result.capabilities.foldingRangeProvider).toBe(true);
    expect(result.capabilities.semanticTokensProvider).toEqual({
      legend: semanticTokensLegend,
      full: true,
      range: true,
    });
    expect(result.capabilities.completionProvider).toEqual({
      triggerCharacters: ['.', '@', '[', '(', '{', ':', ','],
    });
    expect(result.capabilities.signatureHelpProvider).toEqual({
      triggerCharacters: ['(', ','],
    });
  });

  it.each([
    { args: '|', parameter: 0, trigger: '(' },
    { args: '"user", name: |', parameter: 1, trigger: ',' },
    { args: 'priority: |1, name: "visible", target: "user"', parameter: 2, trigger: undefined },
    { args: 'name: "visible",| priority: 1', parameter: 2, trigger: ',' },
    { args: 'name: "visible", |priority: 1', parameter: 2, trigger: undefined },
    { args: 'name: "visible",| priority: 1', parameter: 2, trigger: undefined },
  ])(
    'serves documented signature help through trigger and explicit requests: $args',
    async ({ args, parameter, trigger }) => {
      harness = startHarness(resolveToSchemaWithAttributeContributions);
      await harness.initialize();
      const { source, position } = sourceWithCursor(
        `// use prisma-8\nmodel User { id Int @marker(${args}) }`,
      );
      openDocument(harness, schemaUri, source);
      await harness.waitForDiagnostics(schemaUri);
      const result = await requestSignatureHelp(harness, schemaUri, position, {
        triggerKind:
          trigger === undefined
            ? SignatureHelpTriggerKind.Invoked
            : SignatureHelpTriggerKind.TriggerCharacter,
        isRetrigger: false,
        ...(trigger === undefined ? {} : { triggerCharacter: trigger }),
      });
      expect(result).toEqual({
        activeSignature: 0,
        activeParameter: parameter,
        signatures: [
          {
            label: '@marker(string, name: string, priority?: integer)',
            documentation: {
              kind: MarkupKind.Markdown,
              value: 'Attaches a named marker to a target.',
            },
            parameters: [
              {
                label: 'string',
                documentation: {
                  kind: MarkupKind.Markdown,
                  value: '**target**\n\nThe marker target.',
                },
              },
              {
                label: 'name: string',
                documentation: { kind: MarkupKind.Markdown, value: 'The marker name.' },
              },
              {
                label: 'priority?: integer',
                documentation: { kind: MarkupKind.Markdown, value: 'The marker priority.' },
              },
            ],
          },
        ],
      });
    },
  );

  it.each([
    'model User { id Int @probe(value: choose(mode: First, enabled: |)) }',
    'model User { id Int @probe(value: choose(mode: First,| enabled: true)) }',
    'model User { id Int @probe(value: choose(mode: First, |enabled: true)) }',
    'model User { id Int\n @@probe(value: choose(mode: First, enabled: |)) }',
    'policy Rule { @@probe(value: choose(mode: First, enabled: |)) }',
    'model User { id Int @probe(value: choose(mode: First, enabled: |',
  ])(
    'serves innermost signatures from contributed owners and unfinished input: %s',
    async (body) => {
      const resolution = await recursiveCompletionResolution();
      harness = startHarness(async () => resolution);
      await harness.initialize();
      const { source, position } = sourceWithCursor(`// use prisma-8\n${body}`);
      openDocument(harness, schemaUri, source);
      const diagnostics = await harness.waitForDiagnostics(schemaUri);
      expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'PSL_TEST_INTERPRETATION_FAILED',
      );
      expect(await requestSignatureHelp(harness, schemaUri, position)).toEqual({
        activeSignature: 0,
        activeParameter: 1,
        signatures: [
          {
            label: 'choose(mode: First | Second, enabled?: boolean)',
            documentation: {
              kind: MarkupKind.Markdown,
              value: 'Chooses between the first and second modes.',
            },
            parameters: [
              {
                label: 'mode: First | Second',
                documentation: {
                  kind: MarkupKind.Markdown,
                  value: 'The selected mode.',
                },
              },
              {
                label: 'enabled?: boolean',
                documentation: {
                  kind: MarkupKind.Markdown,
                  value: 'Whether the choice is enabled.',
                },
              },
            ],
          },
        ],
      });
    },
  );

  it('uses the current buffer and suppresses unknown nested signatures without outer fallback', async () => {
    const resolution = await recursiveCompletionResolution();
    harness = startHarness(async () => resolution);
    await harness.initialize();
    const initial = sourceWithCursor(
      '// use prisma-8\nmodel User { id Int @probe(value: choose(|)) }',
    );
    openDocument(harness, schemaUri, initial.source);
    await harness.waitForDiagnostics(schemaUri);
    expect(
      (await requestSignatureHelp(harness, schemaUri, initial.position))?.signatures[0]?.label,
    ).toBe('choose(mode: First | Second, enabled?: boolean)');
    const changed = sourceWithCursor(
      '// use prisma-8\nmodel User { id Int @probe(value: unknown(|)) }',
    );
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: changed.source }],
    });
    expect(await requestSignatureHelp(harness, schemaUri, changed.position)).toBeNull();
  });

  it.each([
    { uri: schemaUri, directive: '', open: true },
    {
      uri: pathToFileURL(join(root, 'outside.prisma')).href,
      directive: '// use prisma-8\n',
      open: true,
    },
    { uri: schemaUri, directive: '// use prisma-8\n', open: false },
  ])(
    'returns no signature help for unmanaged or unopened documents: %j',
    async ({ uri, directive, open }) => {
      harness = startHarness(resolveToSchemaWithAttributeContributions);
      await harness.initialize();
      const { source, position } = sourceWithCursor(`${directive}model User { id Int @marker(|) }`);
      if (open) openDocument(harness, uri, source);
      expect(await requestSignatureHelp(harness, uri, position)).toBeNull();
    },
  );

  it('returns no signature help after a document closes', async () => {
    harness = startHarness(resolveToSchemaWithAttributeContributions);
    await harness.initialize();
    const { source, position } = sourceWithCursor(
      '// use prisma-8\nmodel User { id Int @marker(|) }',
    );
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);
    expect((await requestSignatureHelp(harness, schemaUri, position))?.activeParameter).toBe(0);
    closeDocument(harness, schemaUri);
    expect(await requestSignatureHelp(harness, schemaUri, position)).toBeNull();
  });

  it('contains contribution-factory failures and serves the next signature request', async () => {
    const factory = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('broken signature factory');
      })
      .mockReturnValue(markerAttribute);
    const resolution = await resolveToSchemaWithAttributeContributions(configPath);
    harness = startHarness(async () => ({
      ...resolution,
      controlStack: {
        ...resolution.controlStack,
        authoringContributions: assembleAuthoringContributions([
          {
            id: 'broken-signature',
            authoring: { attributeSpecs: { field: { marker: factory }, model: {} } },
          },
        ]),
      },
    }));
    await harness.initialize();
    const { source, position } = sourceWithCursor(
      '// use prisma-8\nmodel User { id Int @marker(|) }',
    );
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);
    expect(await requestSignatureHelp(harness, schemaUri, position)).toBeNull();
    expect((await requestSignatureHelp(harness, schemaUri, position))?.signatures[0]?.label).toBe(
      '@marker(string, name: string, priority?: integer)',
    );
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('returns no signature help when project configuration cannot load', async () => {
    harness = startHarness(async () => {
      throw new Error('signature config failed');
    });
    await harness.initialize();
    const { source, position } = sourceWithCursor(
      '// use prisma-8\nmodel User { id Int @marker(|) }',
    );
    openDocument(harness, schemaUri, source);
    expect(await requestSignatureHelp(harness, schemaUri, position)).toBeNull();
  });

  it('returns model field type completions for configured PSL inputs', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const { source, position } = sourceWithCursor(
      [
        '// use prisma-8',
        'model User {',
        '  id Int @id',
        '}',
        '',
        'type Address {',
        '  street String',
        '}',
        '',
        'model Post {',
        '  id Int @id',
        '  author |',
        '}',
      ].join('\n'),
    );
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);

    const items = completionItems(await requestCompletion(harness, schemaUri, position));
    expect(items.map((item) => item.label)).toEqual([
      'Boolean',
      'DateTime',
      'Int',
      'String',
      'Post',
      'User',
      'Address',
    ]);
  });

  it('refreshes completion artifacts from the current buffer before classifying', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const initial = ['// use prisma-8', 'model Post {', '  author |', '}'].join('\n');
    const updated = sourceWithCursor(
      [
        '// use prisma-8',
        'model User {',
        '  id Int @id',
        '}',
        '',
        'model Post {',
        '  author U|',
        '}',
      ].join('\n'),
    );
    openDocument(harness, schemaUri, initial);
    await harness.waitForDiagnosticsCount(schemaUri, 1);

    const republished = harness.waitForDiagnosticsCount(schemaUri, 2);
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: updated.source }],
    });

    const items = completionItems(await requestCompletion(harness, schemaUri, updated.position));
    expect(items.map((item) => item.label)).toEqual([
      'Boolean',
      'DateTime',
      'Int',
      'String',
      'Post',
      'User',
    ]);
    await republished;
  });

  it('serves repeated reads without reparsing while no mutation intervenes', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const { source, position } = sourceWithCursor(
      [
        '// use prisma-8',
        'model User {',
        '  id Int @id',
        '}',
        '',
        'model Post {',
        '  author |',
        '}',
      ].join('\n'),
    );
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnosticsCount(schemaUri, 1);

    pipelineMock.runPipeline.mockClear();
    const items = completionItems(await requestCompletion(harness, schemaUri, position));
    expect(items.map((item) => item.label)).toContain('User');
    await expect(requestSemanticTokens(harness, schemaUri)).resolves.not.toEqual({ data: [] });
    await expect(requestFoldingRanges(harness, schemaUri)).resolves.not.toEqual([]);
    expect(pipelineMock.runPipeline).not.toHaveBeenCalled();
  });

  it('parses once for an edit followed by an immediate completion', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const initial = ['// use prisma-8', 'model Post {', '  author ', '}'].join('\n');
    const updated = sourceWithCursor(
      [
        '// use prisma-8',
        'model User {',
        '  id Int @id',
        '}',
        '',
        'model Post {',
        '  author U|',
        '}',
      ].join('\n'),
    );
    openDocument(harness, schemaUri, initial);
    await harness.waitForDiagnosticsCount(schemaUri, 1);

    pipelineMock.runPipeline.mockClear();
    const republished = harness.waitForDiagnosticsCount(schemaUri, 2);
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: updated.source }],
    });

    const items = completionItems(await requestCompletion(harness, schemaUri, updated.position));
    expect(items.map((item) => item.label)).toEqual([
      'Boolean',
      'DateTime',
      'Int',
      'String',
      'Post',
      'User',
    ]);
    await republished;
    expect(pipelineMock.runPipeline).toHaveBeenCalledTimes(1);
    expect(pipelineMock.runPipeline).toHaveBeenCalledWith(
      schemaUri,
      updated.source,
      expect.any(Object),
    );
  });

  it('returns generic block parameter completions for configured PSL descriptors', async () => {
    harness = startHarness(resolveToSchemaWithPslBlockDescriptors);
    await harness.initialize();
    const { source, position } = sourceWithCursor(
      ['// use prisma-8', 'policy UserAccess {', '  wh|', '}'].join('\n'),
    );
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);

    const items = completionItems(await requestCompletion(harness, schemaUri, position));
    expect(items.map((item) => item.label)).toEqual(['on', 'where', 'mode']);
  });

  it('returns configured attribute names and named keys through server completion', async () => {
    harness = startHarness(resolveToSchemaWithAttributeContributions);
    await harness.initialize();
    const namedKey = sourceWithCursor(
      ['// use prisma-8', 'model User {', '  id Int @marker(name: "id", pr|)', '}'].join('\n'),
    );
    openDocument(harness, schemaUri, namedKey.source);
    await harness.waitForDiagnostics(schemaUri);

    const keyItems = completionItems(
      await requestCompletion(harness, schemaUri, namedKey.position),
    );
    expect(keyItems.map((item) => item.label)).toEqual(['priority']);

    const attributeName = sourceWithCursor(
      ['// use prisma-8', 'model User {', '  id Int @|', '}'].join('\n'),
    );
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: attributeName.source }],
    });
    await settle();

    const nameItems = completionItems(
      await requestCompletion(harness, schemaUri, attributeName.position),
    );
    expect(nameItems.map((item) => item.label)).toEqual(['marker']);
  });

  it('returns configured attribute names through server completion when interpretation fails', async () => {
    const failingInterpretationSource = {
      ...completionInterpretationSource,
      interpret: () =>
        notOk({
          summary: 'Schema has 1 error',
          diagnostics: [
            {
              code: 'PSL_TEST_INTERPRETATION_FAILED',
              message: 'interpretation failed',
              span: {
                start: { offset: 19, line: 2, column: 3 },
                end: { offset: 25, line: 2, column: 9 },
              },
            },
          ],
        }),
    } as unknown as PslInterpretCapable;
    harness = startHarness(async (configPath) => {
      const resolution = await resolveToSchemaWithAttributeContributions(configPath);
      return {
        ...resolution,
        interpretation: {
          source: failingInterpretationSource,
          context: completionInterpretationContext,
        },
      };
    });
    await harness.initialize();
    const completion = sourceWithCursor(
      ['// use prisma-8', 'model User {', '  id Int @|', '}'].join('\n'),
    );
    openDocument(harness, schemaUri, completion.source);
    await harness.waitForDiagnostics(schemaUri);

    const items = completionItems(await requestCompletion(harness, schemaUri, completion.position));
    expect(items.map((item) => item.label)).toEqual(['marker']);
  });

  it('returns configured required attribute argument snippets through server completion', async () => {
    harness = startHarness(
      resolveToSchemaWithAttributeContributions,
      snippetCompletionCapabilities,
    );
    await harness.initialize();
    const completion = sourceWithCursor(
      ['// use prisma-8', 'model User {', '  id Int @mar| // keep', '}'].join('\n'),
    );
    openDocument(harness, schemaUri, completion.source);
    await harness.waitForDiagnostics(schemaUri);

    const items = completionItems(await requestCompletion(harness, schemaUri, completion.position));
    const item = completionItemByLabel(items, 'marker');
    expect(item).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: {
        newText: `marker("${targetSnippetPlaceholder}", name: "${nameArgumentSnippetPlaceholder}")`,
      },
    });
    expect(applyCompletionItem(completion.source, item)).toEqual(
      [
        '// use prisma-8',
        'model User {',
        `  id Int @marker("${targetSnippetPlaceholder}", name: "${nameArgumentSnippetPlaceholder}") // keep`,
        '}',
      ].join('\n'),
    );
  });

  it.each([
    [undefined, false],
    [null, false],
    [{ completion: null }, false],
    [{ completion: { supportsTriggerSuggestCommand: true } }, false],
    [{ completion: { supportsTriggerParameterHintsCommand: 'true' } }, false],
    [{ completion: { supportsTriggerParameterHintsCommand: false } }, false],
    [{ completion: { supportsTriggerParameterHintsCommand: true } }, true],
  ])(
    'requires explicit parameter-hints opt-in: %j',
    async (options, enabled) => {
      const resolution = await recursiveCompletionResolution();
      harness = startHarness(async () => resolution, snippetCompletionCapabilities);
      await harness.initialize(options);
      for (const [body, label] of [
        ['model User { id Int @pro| }', 'probe'],
        ['model User { id Int @probe(value: ch|) }', 'choose'],
      ]) {
        const completion = sourceWithCursor(`// use prisma-8\n${body}`);
        openDocument(harness, schemaUri, completion.source);
        await harness.waitForDiagnostics(schemaUri);
        const item = completionItemByLabel(
          completionItems(await requestCompletion(harness, schemaUri, completion.position)),
          label!,
        );
        expect(item.insertTextFormat).toBe(InsertTextFormat.Snippet);
        expect(item.command).toEqual(
          enabled
            ? { title: 'Show argument hints', command: 'editor.action.triggerParameterHints' }
            : undefined,
        );
      }
    },
    5_000,
  );

  it('completes nested keys and values from updated buffers despite interpretation failure', async () => {
    const resolution = await recursiveCompletionResolution();
    harness = startHarness(async () => resolution);
    await harness.initialize();
    const initial = sourceWithCursor(
      '// use prisma-next\nmodel User { id Int @probe(value: choose(|)) }',
    );
    openDocument(harness, schemaUri, initial.source);
    const diagnostics = await harness.waitForDiagnostics(schemaUri);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'PSL_TEST_INTERPRETATION_FAILED',
    );
    expect(
      completionItems(await requestCompletion(harness, schemaUri, initial.position)).map(
        (item) => item.label,
      ),
    ).toEqual(['mode', 'enabled']);
    const changed = sourceWithCursor(
      '// use prisma-next\nmodel User { id Int @probe(value: choose(mode: Fi|rst)) }',
    );
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: changed.source }],
    });
    await settle();
    const values = completionItems(await requestCompletion(harness, schemaUri, changed.position));
    expect(values.map((item) => item.label)).toEqual(['First', 'Second']);
    expect(applyCompletionItem(changed.source, completionItemByLabel(values, 'Second'))).toBe(
      '// use prisma-next\nmodel User { id Int @probe(value: choose(mode: Second)) }',
    );
  }, 5_000);

  it.each([
    ['model User { id Int @probe(flags: [, |]) }', ['true', 'false']],
    ['model User { id Int\n @@probe(value: choose(mode: |)) }', ['First', 'Second']],
    ['policy Rule { @@probe(value: choose(mode: |)) }', ['First', 'Second']],
    ['model User { id Int @probe(value: choose(mode: |', ['First', 'Second']],
  ])(
    'completes configured collection and contributed owner values: %s',
    async (body, expected) => {
      const resolution = await recursiveCompletionResolution();
      harness = startHarness(async () => resolution);
      await harness.initialize();
      const completion = sourceWithCursor(`// use prisma-next\n${body}`);
      openDocument(harness, schemaUri, completion.source);
      await harness.waitForDiagnostics(schemaUri);
      expect(
        completionItems(await requestCompletion(harness, schemaUri, completion.position)).map(
          (item) => item.label,
        ),
      ).toEqual(expected);
    },
    5_000,
  );

  it.each([false, true])(
    'respects snippet capability for nested function edits: %s',
    async (snippets) => {
      const resolution = await recursiveCompletionResolution();
      harness = startHarness(async () => resolution, snippets ? snippetCompletionCapabilities : {});
      await harness.initialize();
      const completion = sourceWithCursor(
        '// use prisma-next\nmodel User { id Int @probe(value: ch|) // keep\n}',
      );
      openDocument(harness, schemaUri, completion.source);
      await harness.waitForDiagnostics(schemaUri);
      const item = completionItemByLabel(
        completionItems(await requestCompletion(harness, schemaUri, completion.position)),
        'choose',
      );
      expect(item.insertTextFormat).toBe(snippets ? InsertTextFormat.Snippet : undefined);
      const inserted = snippets ? `choose(mode: ${modeSnippetPlaceholder})` : 'choose';
      expect(applyCompletionItem(completion.source, item)).toBe(
        `// use prisma-next\nmodel User { id Int @probe(value: ${inserted}) // keep\n}`,
      );
    },
    5_000,
  );

  it.each([false, true])(
    'negotiates named-key value stops for snippet support: %s',
    async (snippets) => {
      const resolution = await recursiveCompletionResolution();
      harness = startHarness(async () => resolution, snippets ? snippetCompletionCapabilities : {});
      await harness.initialize();
      const completion = sourceWithCursor(
        '// use prisma-8\nmodel User { id Int @probe(value: choose(mo|de)) }',
      );
      openDocument(harness, schemaUri, completion.source);
      await harness.waitForDiagnostics(schemaUri);
      const item = completionItemByLabel(
        completionItems(await requestCompletion(harness, schemaUri, completion.position)),
        'mode',
      );
      expect(item.textEdit?.newText).toBe(`mode: ${snippets ? modeSnippetPlaceholder : ''}`);
      expect(item.insertTextFormat).toBe(snippets ? InsertTextFormat.Snippet : undefined);
      expect(item.command).toBeUndefined();
      expect(applyCompletionItem(completion.source, item)).toBe(
        `// use prisma-8\nmodel User { id Int @probe(value: choose(mode: ${snippets ? modeSnippetPlaceholder : ''})) }`,
      );
    },
    5_000,
  );

  it.each([
    [undefined, false],
    [null, false],
    [true, false],
    ['true', false],
    [{}, false],
    [{ completion: null }, false],
    [{ completion: true }, false],
    [{ completion: { supportsTriggerSuggestCommand: 'true' } }, false],
    [{ completion: { supportsTriggerSuggestCommand: false } }, false],
    [{ completion: { supportsTriggerSuggestCommand: true } }, true],
  ])(
    'requires explicit trigger-suggest opt-in: %j',
    async (initializationOptions, enabled) => {
      const resolution = await recursiveCompletionResolution();
      harness = startHarness(async () => resolution);
      await harness.initialize(initializationOptions);
      const completion = sourceWithCursor(
        '// use prisma-8\nmodel User { id Int @probe(value: choose(|)) }',
      );
      openDocument(harness, schemaUri, completion.source);
      await harness.waitForDiagnostics(schemaUri);
      const item = completionItemByLabel(
        completionItems(await requestCompletion(harness, schemaUri, completion.position)),
        'mode',
      );
      expect(item.textEdit?.newText).toBe('mode: ');
      expect(item.command).toEqual(
        enabled
          ? { title: 'Suggest argument values', command: 'editor.action.triggerSuggest' }
          : undefined,
      );
    },
    5_000,
  );

  it.each([false, true])(
    'only retriggers new named-key value slots, snippets=%s',
    async (snippets) => {
      const resolution = await recursiveCompletionResolution();
      harness = startHarness(async () => resolution, snippets ? snippetCompletionCapabilities : {});
      await harness.initialize({ completion: { supportsTriggerSuggestCommand: true } });
      for (const [args, label, retrigger] of [
        ['value: choose(mo|de)', 'mode', true],
        ['value: choose(mo|de: First)', 'mode', false],
        ['value: choose(mode: |)', 'First', false],
        ['value: |', 'choose', false],
      ] as const) {
        const completion = sourceWithCursor(
          `// use prisma-8\nmodel User { id Int @probe(${args}) }`,
        );
        openDocument(harness, schemaUri, completion.source);
        await harness.waitForDiagnostics(schemaUri);
        const item = completionItemByLabel(
          completionItems(await requestCompletion(harness, schemaUri, completion.position)),
          label,
        );
        expect(item.command).toEqual(
          retrigger
            ? { title: 'Suggest argument values', command: 'editor.action.triggerSuggest' }
            : undefined,
        );
        if (retrigger)
          expect(item.textEdit?.newText).toBe(`mode: ${snippets ? modeSnippetPlaceholder : ''}`);
      }
    },
    5_000,
  );

  it('uses actual SQL relation grammar and current-buffer referenced model fields', async () => {
    const resolution = await recursiveCompletionResolution();
    harness = startHarness(async () => resolution);
    await harness.initialize();
    const source = (field: string) =>
      `// use prisma-next\nmodel Target { topOnly Int }\nnamespace remote { model Target { ${field} Int } }\nmodel Owner { ownOnly Int\n relation remote.Target @relation(references: [|]) }`;
    const initial = sourceWithCursor(source('remoteOnly'));
    openDocument(harness, schemaUri, initial.source);
    await harness.waitForDiagnostics(schemaUri);
    expect(
      completionItems(await requestCompletion(harness, schemaUri, initial.position)).map(
        (item) => item.label,
      ),
    ).toEqual(['remoteOnly']);
    const changed = sourceWithCursor(source('renamedRemote'));
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: changed.source }],
    });
    await settle();
    const items = completionItems(await requestCompletion(harness, schemaUri, changed.position));
    expect(items.map((item) => item.label)).toEqual(['renamedRemote']);
    expect(applyCompletionItem(changed.source, completionItemByLabel(items, 'renamedRemote'))).toBe(
      changed.source.replace('references: []', 'references: [renamedRemote]'),
    );
  }, 5_000);

  it('returns declaration keyword completions with plain-text edits by default', async () => {
    harness = startHarness(resolveToSchemaWithPslBlockDescriptors);
    await harness.initialize();
    const { source, position } = sourceWithCursor('// use prisma-8\n|');
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);

    const items = completionItems(await requestCompletion(harness, schemaUri, position));
    expect(items.map((item) => item.label)).toEqual([
      'model',
      'type',
      'types',
      'namespace',
      'policy',
    ]);
    expect(items.find((item) => item.label === 'model')).toMatchObject({
      textEdit: { newText: 'model ' },
    });
    expect(items.find((item) => item.label === 'model')?.insertTextFormat).toBeUndefined();
  });

  it('returns Prisma 8 completions for a VS Code-shaped Windows document URI', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    try {
      const windowsDocumentUri = 'file:///d%3A/project/next.prisma';
      harness = startHarness(async () => resolutionForInputs(['D:\\project\\next.prisma']));
      await harness.initialize();
      openDocument(harness, windowsDocumentUri, '// use prisma-8\n');
      await harness.waitForDiagnostics(windowsDocumentUri);

      const items = completionItems(
        await requestCompletion(harness, windowsDocumentUri, { line: 1, character: 0 }),
      );
      expect(items.find((item) => item.label === 'namespace')).toMatchObject({
        kind: CompletionItemKind.Keyword,
        detail: 'Groups declarations belonging to the same database schema or database.',
      });
      expect(items.map((item) => item.label)).not.toContain('datasource');
    } finally {
      platform.mockRestore();
    }
  });

  it('returns declaration keyword snippets when the client supports snippets', async () => {
    harness = startHarness(resolveToSchemaWithPslBlockDescriptors, snippetCompletionCapabilities);
    await harness.initialize();
    const { source, position } = sourceWithCursor('// use prisma-8\n|');
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);

    const items = completionItems(await requestCompletion(harness, schemaUri, position));
    expect(items.find((item) => item.label === 'model')).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `model ${nameSnippetPlaceholder} {\n  \${0:// Fields}\n}` },
    });
    expect(items.find((item) => item.label === 'policy')).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: {
        newText: `policy ${nameSnippetPlaceholder} {\n  \${0:// Block parameters and attributes}\n}`,
      },
    });
  });

  it('returns namespace-body declaration keywords without document-only keywords', async () => {
    harness = startHarness(resolveToSchemaWithPslBlockDescriptors);
    await harness.initialize();
    const { source, position } = sourceWithCursor(
      ['// use prisma-8', 'namespace feature {', '  |', '}'].join('\n'),
    );
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);

    const items = completionItems(await requestCompletion(harness, schemaUri, position));
    expect(items.map((item) => item.label)).toEqual(['model', 'type', 'policy']);
    expect(items.map((item) => item.label)).not.toContain('types');
    expect(items.map((item) => item.label)).not.toContain('namespace');
  });

  it('returns no completion items for unconfigured PSL documents', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const otherUri = pathToFileURL(join(root, 'not-a-schema.psl')).toString();
    const { source, position } = sourceWithCursor(
      [
        '// use prisma-8',
        'model User {',
        '  id Int @id',
        '}',
        '',
        'model Post {',
        '  author |',
        '}',
      ].join('\n'),
    );
    openDocument(harness, otherUri, source);

    const items = completionItems(await requestCompletion(harness, otherUri, position));
    expect(items).toEqual([]);
  });

  it('returns no completion items for ordinary field attribute contexts', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const { source, position } = sourceWithCursor(
      ['// use prisma-8', 'model User {', '  id Int @|', '}'].join('\n'),
    );
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);

    const items = completionItems(await requestCompletion(harness, schemaUri, position));
    expect(items).toEqual([]);
  });

  it('returns no completion items for ordinary model attribute contexts', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const { source, position } = sourceWithCursor(
      ['// use prisma-8', 'model User {', '  id Int @id', '  @@|', '}'].join('\n'),
    );
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);

    const items = completionItems(await requestCompletion(harness, schemaUri, position));
    expect(items).toEqual([]);
  });

  it('publishes parser diagnostics for an opened configured PSL input', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel {',
      },
    });

    const diagnostics = await harness.waitForDiagnostics(schemaUri);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it('publishes an empty set for a clean configured PSL input', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel User {\n  id Int @id\n}\n',
      },
    });

    const diagnostics = await harness.waitForDiagnostics(schemaUri);
    expect(diagnostics).toEqual([]);
  });

  it('never manages a document that is not a configured input', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    const otherUri = pathToFileURL(join(root, 'not-a-schema.psl')).toString();
    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: otherUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel {',
      },
    });

    await settle();
    expect(harness.publishCount(otherUri)).toBe(0);
    expect(harness.getDocumentAst(otherUri)).toBeUndefined();
  });

  it('clears diagnostics when an edit fixes the document', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel {',
      },
    });
    const broken = await harness.waitForDiagnostics(schemaUri);
    expect(broken.length).toBeGreaterThan(0);

    const cleared = new Promise<readonly Diagnostic[]>((resolve) => {
      harness?.client.onNotification(PublishDiagnosticsNotification.type, (params) => {
        if (params.uri === schemaUri && params.diagnostics.length === 0) {
          resolve(params.diagnostics);
        }
      });
    });
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: '// use prisma-8\nmodel User {\n  id Int @id\n}\n' }],
    });
    expect(await cleared).toEqual([]);
  });

  it('does not publish diagnostics when config resolution fails', async () => {
    harness = startHarness(resolveFails);
    const result = await harness.initialize();
    expect(result).toBeDefined();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel {',
      },
    });
    await waitUntil(() => configResolutionMock.resolveConfigInputs.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.latestDiagnostics(schemaUri)).toBeUndefined();
  });

  it('formats a configured PSL input with one whole-document edit', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    openDocument(harness, schemaUri, unformattedPsl);
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);

    await expect(requestFormatting(harness, schemaUri)).resolves.toEqual([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 3, character: 1 } },
        newText: formattedPsl,
      },
    ]);
  });

  it('returns no edits for canonical PSL input', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    openDocument(harness, schemaUri, formattedPsl);
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);

    await expect(requestFormatting(harness, schemaUri)).resolves.toEqual([]);
  });

  it('serves a schema carrying the directive earlier releases wrote, and formatting renames it', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const legacyPsl = formattedPsl.replace('// use prisma-8', '// use prisma-next');
    openDocument(harness, schemaUri, legacyPsl);
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);

    await expect(requestFormatting(harness, schemaUri)).resolves.toEqual([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 4, character: 0 } },
        newText: formattedPsl,
      },
    ]);
  });

  it('returns no edits for unconfigured PSL documents', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const otherUri = pathToFileURL(join(root, 'not-a-schema.psl')).toString();
    openDocument(harness, otherUri, unformattedPsl);

    await expect(requestFormatting(harness, otherUri)).resolves.toEqual([]);
  });

  it('returns no edits for malformed PSL', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    openDocument(harness, schemaUri, '// use prisma-8\nmodel {');
    expect((await harness.waitForDiagnostics(schemaUri)).length).toBeGreaterThan(0);

    await expect(requestFormatting(harness, schemaUri)).resolves.toEqual([]);
  });

  it('returns no edits for missing and closed documents', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    await expect(requestFormatting(harness, schemaUri)).resolves.toEqual([]);

    openDocument(harness, schemaUri, unformattedPsl);
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);
    const cleared = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    closeDocument(harness, schemaUri);
    expect(await cleared).toEqual([]);
    await expect(requestFormatting(harness, schemaUri)).resolves.toEqual([]);
  });

  it('uses Prisma config formatter options', async () => {
    harness = startHarness(resolveToSchemaWithFormatter({ indent: 'tab', newline: 'CRLF' }));
    await harness.initialize();
    openDocument(harness, schemaUri, unformattedPsl);
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);

    await expect(requestFormatting(harness, schemaUri)).resolves.toEqual([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 3, character: 1 } },
        newText: '// use prisma-8\r\nmodel User {\r\n\tid Int\r\n}\r\n',
      },
    ]);
  });

  it('returns full semantic tokens for a configured open PSL input', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    openDocument(harness, schemaUri, '// use prisma-8\nmodel User {\n  id Int @id\n}\n');
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);

    await expect(requestSemanticTokens(harness, schemaUri)).resolves.toEqual({
      data: [
        0, 0, 15, 9, 0, 1, 0, 5, 0, 0, 0, 6, 4, 2, 1, 1, 2, 2, 5, 1, 0, 3, 3, 4, 2, 0, 4, 3, 6, 0,
      ],
    });
  });

  it('returns range semantic tokens intersecting the requested range', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    openDocument(
      harness,
      schemaUri,
      '// use prisma-8\nmodel User {\n  id Int @id\n}\n\nmodel Post {\n  id Int @id\n}\n',
    );
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);

    await expect(
      requestSemanticTokensRange(harness, schemaUri, {
        start: { line: 0, character: 0 },
        end: { line: 3, character: 0 },
      }),
    ).resolves.toEqual({
      data: [
        0, 0, 15, 9, 0, 1, 0, 5, 0, 0, 0, 6, 4, 2, 1, 1, 2, 2, 5, 1, 0, 3, 3, 4, 2, 0, 4, 3, 6, 0,
      ],
    });
  });

  it('returns empty semantic tokens for unconfigured documents', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const otherUri = pathToFileURL(join(root, 'not-a-schema.psl')).toString();
    openDocument(harness, otherUri, '// use prisma-8\nmodel User {\n  id Int @id\n}\n');

    await expect(requestSemanticTokens(harness, otherUri)).resolves.toEqual({ data: [] });
  });

  it('returns empty semantic tokens for missing and closed documents', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    await expect(requestSemanticTokens(harness, schemaUri)).resolves.toEqual({ data: [] });

    openDocument(harness, schemaUri, '// use prisma-8\nmodel User {\n  id Int @id\n}\n');
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);
    const closed = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    closeDocument(harness, schemaUri);
    expect(await closed).toEqual([]);

    await expect(requestSemanticTokens(harness, schemaUri)).resolves.toEqual({ data: [] });
  });

  it('returns best-effort semantic tokens for malformed configured inputs', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    openDocument(harness, schemaUri, '// use prisma-8\nmodel User {\n  id Int @id\n');
    expect((await harness.waitForDiagnostics(schemaUri)).length).toBeGreaterThan(0);

    const tokens = await requestSemanticTokens(harness, schemaUri);
    expect(tokens?.data.length).toBeGreaterThan(0);
    expect(semanticTokenChunks(tokens).every((chunk) => chunk.length === 5)).toBe(true);
  });

  it('returns empty semantic tokens when config discovery fails', async () => {
    harness = startHarness(resolveToSchema, {}, async () => {
      throw new Error('config discovery failed');
    });
    await harness.initialize();
    openDocument(harness, schemaUri, formattedPsl);

    await expect(requestSemanticTokens(harness, schemaUri)).resolves.toEqual({ data: [] });
  });

  it('returns empty semantic tokens when config resolution fails', async () => {
    harness = startHarness(resolveFails);
    await harness.initialize();
    openDocument(harness, schemaUri, '// use prisma-8\nmodel User {\n  id Int @id\n}\n');
    await waitUntil(() => configResolutionMock.resolveConfigInputs.mock.calls.length === 1);

    await expect(requestSemanticTokens(harness, schemaUri)).resolves.toEqual({ data: [] });
  });

  it('returns empty semantic tokens for oversized configured inputs', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    openDocument(harness, schemaUri, `// use prisma-8\n// ${'x'.repeat(100_000)}`);
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);

    await expect(requestSemanticTokens(harness, schemaUri)).resolves.toEqual({ data: [] });
  });

  it('returns semantic tokens for the current edit', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    openDocument(harness, schemaUri, '// use prisma-8\nmodel User {\n  id Int @id\n}\n');
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);

    const cleared = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: '// use prisma-8\nmodel Invoice {\n  id Int @id\n}\n' }],
    });
    await cleared;

    await expect(requestSemanticTokens(harness, schemaUri)).resolves.toEqual({
      data: [
        0, 0, 15, 9, 0, 1, 0, 5, 0, 0, 0, 6, 7, 2, 1, 1, 2, 2, 5, 1, 0, 3, 3, 4, 2, 0, 4, 3, 6, 0,
      ],
    });
  });

  it('returns semantic tokens for the current edit after a delayed project load', async () => {
    const load = deferred<ConfigResolution>();
    harness = startHarness(async () => load.promise);
    await harness.initialize();

    openDocument(harness, schemaUri, '// use prisma-8\nmodel User {\n  id Int @id\n}\n');
    const currentDiagnostics = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: '// use prisma-8\nmodel Invoice {\n  id Int @id\n}\n' }],
    });
    load.resolve(resolutionForInputs([schemaPath]));
    await currentDiagnostics;

    await expect(requestSemanticTokens(harness, schemaUri)).resolves.toEqual({
      data: [
        0, 0, 15, 9, 0, 1, 0, 5, 0, 0, 0, 6, 7, 2, 1, 1, 2, 2, 5, 1, 0, 3, 3, 4, 2, 0, 4, 3, 6, 0,
      ],
    });
  });
});

const duplicateModelSource = [
  '// use prisma-8',
  'model User {',
  '  id Int @id',
  '}',
  '',
  'model User {',
  '  id Int @id',
  '}',
].join('\n');

describe('language server symbol-table diagnostics', {
  timeout: timeouts.databaseOperation,
}, () => {
  it('publishes a PSL_DUPLICATE_DECLARATION diagnostic for a duplicate top-level declaration', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: duplicateModelSource,
      },
    });

    const diagnostics = await harness.waitForDiagnostics(schemaUri);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('PSL_DUPLICATE_DECLARATION');
  });

  it('publishes a PSL_INVALID_QUALIFIED_TYPE diagnostic for an over-qualified field type', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    const source = ['// use prisma-8', 'model Profile {', '  user a.b.c', '}'].join('\n');
    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: source },
    });

    const diagnostics = await harness.waitForDiagnostics(schemaUri);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'PSL_INVALID_QUALIFIED_TYPE',
    );
  });

  it('clears the symbol-table diagnostic once an edit fixes the document', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: duplicateModelSource,
      },
    });
    const broken = await harness.waitForDiagnostics(schemaUri);
    expect(broken.map((diagnostic) => diagnostic.code)).toContain('PSL_DUPLICATE_DECLARATION');

    const cleared = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [
        {
          text: '// use prisma-8\nmodel User {\n  id Int @id\n}\n\nmodel Post {\n  id Int @id\n}\n',
        },
      ],
    });
    expect(await cleared).toEqual([]);
  });

  it('publishes an empty set for a clean configured PSL input with the symbol-table tier active', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel User {\n  id Int @id\n}\n',
      },
    });

    const diagnostics = await harness.waitForDiagnostics(schemaUri);
    expect(diagnostics).toEqual([]);
  });

  it('publishes diagnostics matching parse + buildSymbolTable for the same inputs (build parity)', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    const source = [
      '// use prisma-8',
      'model Profile {',
      '  user a.b.c',
      '}',
      '',
      'model Profile {',
      '  id Int @id',
      '}',
    ].join('\n');
    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: source },
    });

    const published = await harness.waitForDiagnostics(schemaUri);
    const { parseDiagnostics, symbolTableDiagnostics } = parseAndSymbolTableDiagnostics(source);

    expect(published).toEqual(
      toPublishedDiagnostics([...parseDiagnostics, ...symbolTableDiagnostics]),
    );
  });

  it('orders parse diagnostics ahead of symbol-table diagnostics regardless of source position', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    // The unterminated `model Dangling` (a parse-tier diagnostic) sits *after*
    // the duplicate `model User` (a symbol-table-tier diagnostic) in the source,
    // so a stable parse-then-symbol-table merge must reorder them on publish.
    const source = [
      '// use prisma-8',
      'model User {',
      '  id Int @id',
      '}',
      '',
      'model User {',
      '  id Int @id',
      '}',
      '',
      'model Dangling {',
      '  id Int',
    ].join('\n');
    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: source },
    });

    const published = await harness.waitForDiagnostics(schemaUri);
    const { parseDiagnostics, symbolTableDiagnostics } = parseAndSymbolTableDiagnostics(source);

    expect(parseDiagnostics.length).toBeGreaterThan(0);
    expect(symbolTableDiagnostics.length).toBeGreaterThan(0);
    expect(published).toEqual(
      toPublishedDiagnostics([...parseDiagnostics, ...symbolTableDiagnostics]),
    );
    // The first published diagnostic (parse tier) lies on a later line than the
    // second (symbol-table tier): ordering is by tier, not by source position.
    expect(published[0]?.range.start.line ?? 0).toBeGreaterThan(
      published[1]?.range.start.line ?? 0,
    );
  });

  it('does not crash on a malformed buffer and still publishes a diagnostic set', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel User {\n  id ',
      },
    });

    const diagnostics = await harness.waitForDiagnostics(schemaUri);
    expect(Array.isArray(diagnostics)).toBe(true);
  });

  it('publishes nothing for a document that is not a configured input', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    const otherUri = pathToFileURL(join(root, 'not-a-schema.psl')).toString();
    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: otherUri, languageId: 'prisma', version: 1, text: duplicateModelSource },
    });

    await settle();
    expect(harness.publishCount(otherUri)).toBe(0);
  });
});

function mutableResolve(initial: ResolveInputs): {
  resolve: ResolveInputs;
  set: (next: ResolveInputs) => void;
} {
  let current = initial;
  return {
    resolve: (configPath) => current(configPath),
    set: (next) => {
      current = next;
    },
  };
}

const resolveToNothing: ResolveInputs = async () => emptyResolution();

const resolveFails: ResolveInputs = async () => {
  throw new Error('config failed');
};

function watchedFilesRegistrations(harness: Harness) {
  return harness.registrations
    .flatMap((params) => params.registrations)
    .filter((registration) => registration.method === 'workspace/didChangeWatchedFiles');
}

function findNearestConfigForPrefixes(
  entries: readonly { readonly prefix: string; readonly configPath: string }[],
): FindNearestConfigPathForFile {
  return async (filePath) => entries.find((entry) => filePath.startsWith(entry.prefix))?.configPath;
}

function controlledPromise(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeouts.default) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe('language server project registry', { timeout: timeouts.databaseOperation }, () => {
  it('diagnoses open inputs from two configs in one server process', async () => {
    const projectARoot = join(root, 'project-a');
    const projectBRoot = join(root, 'project-b');
    const projectAConfigPath = join(projectARoot, 'prisma.config.ts');
    const projectBConfigPath = join(projectBRoot, 'prisma.config.ts');
    const projectASchemaPath = join(projectARoot, 'schema.psl');
    const projectBSchemaPath = join(projectBRoot, 'schema.psl');
    const projectASchemaUri = pathToFileURL(projectASchemaPath).toString();
    const projectBSchemaUri = pathToFileURL(projectBSchemaPath).toString();
    const resolvedConfigs: string[] = [];
    const resolveInputs: ResolveInputs = async (configPath) => {
      resolvedConfigs.push(configPath);
      return resolutionForInputs(
        configPath === projectAConfigPath
          ? [projectASchemaPath]
          : configPath === projectBConfigPath
            ? [projectBSchemaPath]
            : [],
      );
    };
    harness = startHarness(
      resolveInputs,
      {},
      findNearestConfigForPrefixes([
        { prefix: projectARoot, configPath: projectAConfigPath },
        { prefix: projectBRoot, configPath: projectBConfigPath },
      ]),
    );
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: projectASchemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel {',
      },
    });
    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: projectBSchemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel {',
      },
    });

    expect((await harness.waitForDiagnostics(projectASchemaUri)).length).toBeGreaterThan(0);
    expect((await harness.waitForDiagnostics(projectBSchemaUri)).length).toBeGreaterThan(0);
    expect(resolvedConfigs).toEqual([projectAConfigPath, projectBConfigPath]);
  });

  it('creates a project when an opened file belongs to a previously unseen config', async () => {
    const unseenRoot = join(root, 'previously-unseen');
    const unseenConfigPath = join(unseenRoot, 'prisma.config.ts');
    const unseenSchemaPath = join(unseenRoot, 'schema.psl');
    const unseenSchemaUri = pathToFileURL(unseenSchemaPath).toString();
    const resolvedConfigs: string[] = [];
    const resolveInputs: ResolveInputs = async (configPath) => {
      resolvedConfigs.push(configPath);
      return resolutionForInputs(configPath === unseenConfigPath ? [unseenSchemaPath] : []);
    };
    harness = startHarness(
      resolveInputs,
      {},
      findNearestConfigForPrefixes([{ prefix: unseenRoot, configPath: unseenConfigPath }]),
    );
    await harness.initialize();
    expect(resolvedConfigs).toEqual([]);

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: unseenSchemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel {',
      },
    });

    expect((await harness.waitForDiagnostics(unseenSchemaUri)).length).toBeGreaterThan(0);
    expect(resolvedConfigs).toEqual([unseenConfigPath]);
  });

  it('publishes no diagnostics for a PSL file that is not a configured input in its project', async () => {
    const projectRoot = join(root, 'non-input-project');
    const projectConfigPath = join(projectRoot, 'prisma.config.ts');
    const schemaPath = join(projectRoot, 'schema.psl');
    const otherPath = join(projectRoot, 'other.psl');
    const otherUri = pathToFileURL(otherPath).toString();
    const resolveInputs: ResolveInputs = async () => resolutionForInputs([schemaPath]);
    harness = startHarness(
      resolveInputs,
      {},
      findNearestConfigForPrefixes([{ prefix: projectRoot, configPath: projectConfigPath }]),
    );
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: otherUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel {',
      },
    });

    await settle();
    expect(harness.publishCount(otherUri)).toBe(0);
  });

  it('does not fall back to a parent config when the nearest config fails to load', async () => {
    const parentRoot = join(root, 'parent-project');
    const childRoot = join(parentRoot, 'child-project');
    const parentConfigPath = join(parentRoot, 'prisma.config.ts');
    const childConfigPath = join(childRoot, 'prisma.config.ts');
    const childSchemaPath = join(childRoot, 'schema.psl');
    const childSchemaUri = pathToFileURL(childSchemaPath).toString();
    const resolvedConfigs: string[] = [];
    const resolveInputs: ResolveInputs = async (configPath) => {
      resolvedConfigs.push(configPath);
      if (configPath === parentConfigPath) {
        return resolutionForInputs([childSchemaPath]);
      }
      throw new Error('invalid child config');
    };
    harness = startHarness(
      resolveInputs,
      {},
      findNearestConfigForPrefixes([{ prefix: childRoot, configPath: childConfigPath }]),
    );
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: childSchemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel {',
      },
    });

    await waitUntil(() => resolvedConfigs.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.latestDiagnostics(childSchemaUri)).toBeUndefined();
    expect(resolvedConfigs).toEqual([childConfigPath]);
  });

  it('serves reads during a config reload from the fresh resolution', async () => {
    const { source, position } = sourceWithCursor(
      [
        '// use prisma-8',
        'model User {',
        '  id Int @id',
        '}',
        '',
        'model Post {',
        '  author |',
        '}',
      ].join('\n'),
    );
    const refreshLoad = controlledPromise();
    let loadCount = 0;
    const resolveInputs: ResolveInputs = async () => {
      loadCount += 1;
      if (loadCount === 1) {
        return resolutionForInputs([schemaPath]);
      }
      await refreshLoad.promise;
      return emptyResolution();
    };
    harness = startHarness(resolveInputs, watchedFilesCapabilities);
    await harness.initialize();
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);

    harness.notifyConfigChanged();
    const completion = requestCompletion(harness, schemaUri, position);
    await settle();
    refreshLoad.resolve();

    expect(completionItems(await completion)).toEqual([]);
  });

  it('queues project refreshes behind in-flight project loads', async () => {
    const projectRoot = join(root, 'queued-load-project');
    const projectConfigPath = join(projectRoot, 'prisma.config.ts');
    const schemaPath = join(projectRoot, 'schema.psl');
    const schemaUri = pathToFileURL(schemaPath).toString();
    const initialLoad = controlledPromise();
    const refreshLoad = controlledPromise();
    let loadCount = 0;
    const resolveInputs: ResolveInputs = async () => {
      loadCount += 1;
      if (loadCount === 1) {
        await initialLoad.promise;
        return resolutionForInputs([schemaPath]);
      }
      await refreshLoad.promise;
      return emptyResolution();
    };
    harness = startHarness(
      resolveInputs,
      watchedFilesCapabilities,
      findNearestConfigForPrefixes([{ prefix: projectRoot, configPath: projectConfigPath }]),
    );
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel {',
      },
    });
    await waitUntil(() => loadCount === 1);
    harness.notifyConfigChanged(pathToFileURL(projectConfigPath).toString());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadCount).toBe(1);

    initialLoad.resolve();
    await waitUntil(() => loadCount === 2);
    refreshLoad.resolve();

    expect(
      await harness.waitForDiagnosticsMatching(
        schemaUri,
        (diagnostics) => diagnostics.length === 0,
      ),
    ).toEqual([]);
  });

  it('updates only the project identified by the changed config path', async () => {
    const projectARoot = join(root, 'config-change-a');
    const projectBRoot = join(root, 'config-change-b');
    const projectAConfigPath = join(projectARoot, 'prisma.config.ts');
    const projectBConfigPath = join(projectBRoot, 'prisma.config.ts');
    const projectASchemaPath = join(projectARoot, 'schema.psl');
    const projectBSchemaPath = join(projectBRoot, 'schema.psl');
    const projectASchemaUri = pathToFileURL(projectASchemaPath).toString();
    const projectBSchemaUri = pathToFileURL(projectBSchemaPath).toString();
    const resolvedConfigs: string[] = [];
    let projectBIsConfigured = true;
    const resolveInputs: ResolveInputs = async (configPath) => {
      resolvedConfigs.push(configPath);
      return resolutionForInputs(
        configPath === projectAConfigPath
          ? [projectASchemaPath]
          : configPath === projectBConfigPath && projectBIsConfigured
            ? [projectBSchemaPath]
            : [],
      );
    };
    harness = startHarness(
      resolveInputs,
      watchedFilesCapabilities,
      findNearestConfigForPrefixes([
        { prefix: projectARoot, configPath: projectAConfigPath },
        { prefix: projectBRoot, configPath: projectBConfigPath },
      ]),
    );
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: projectASchemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel {',
      },
    });
    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: projectBSchemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel {',
      },
    });
    expect((await harness.waitForDiagnostics(projectASchemaUri)).length).toBeGreaterThan(0);
    expect((await harness.waitForDiagnostics(projectBSchemaUri)).length).toBeGreaterThan(0);

    resolvedConfigs.length = 0;
    const projectBCleared = harness.waitForDiagnosticsMatching(
      projectBSchemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    projectBIsConfigured = false;
    harness.notifyConfigChanged(pathToFileURL(projectBConfigPath).toString());

    expect(await projectBCleared).toEqual([]);
    expect(resolvedConfigs).toEqual([projectBConfigPath]);
  });
});

describe('language server config watching', { timeout: timeouts.databaseOperation }, () => {
  it('requests a watched-files registration scoped to the config path', async () => {
    harness = startHarness(resolveToSchema, watchedFilesCapabilities);
    await harness.initialize();
    await harness.waitForWatchedFilesRegistration(timeouts.default);

    const watchedFiles = watchedFilesRegistrations(harness);
    expect(watchedFiles.length).toBe(1);
    expect(JSON.stringify(watchedFiles[0]?.registerOptions)).toContain('prisma.config.ts');
  });

  it('resolves the workspace root from workspaceFolders when rootUri is absent', async () => {
    harness = startHarness(resolveToSchema, watchedFilesCapabilities);
    const workspaceRoot = join(root, 'ws-folder');
    await harness.client.sendRequest(InitializeRequest.type, {
      processId: process.pid,
      rootUri: null,
      capabilities: watchedFilesCapabilities,
      workspaceFolders: [{ uri: pathToFileURL(workspaceRoot).toString(), name: 'ws-folder' }],
    });
    harness.client.sendNotification(InitializedNotification.type, {});
    await harness.waitForWatchedFilesRegistration(timeouts.default);

    const serialized = JSON.stringify(watchedFilesRegistrations(harness)[0]?.registerOptions);
    expect(serialized).toContain('ws-folder');
    expect(serialized).not.toContain('\\\\');
  });

  it('does not request registration when the client lacks dynamic registration', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    await harness.waitForWarning((message) =>
      message.includes('does not support dynamic file-watcher registration'),
    );

    expect(watchedFilesRegistrations(harness).length).toBe(0);
  });

  it('starts diagnosing an open doc that a config edit adds as an input', async () => {
    const hook = mutableResolve(resolveToNothing);
    harness = startHarness(hook.resolve, watchedFilesCapabilities);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel {',
      },
    });
    await settle();
    expect(harness.publishCount(schemaUri)).toBe(0);

    const diagnosed = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length > 0,
    );
    hook.set(resolveToSchema);
    harness.notifyConfigChanged();
    expect((await diagnosed).length).toBeGreaterThan(0);
  });

  it('clears an open doc that a config edit removes as an input', async () => {
    const hook = mutableResolve(resolveToSchema);
    harness = startHarness(hook.resolve, watchedFilesCapabilities);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel {',
      },
    });
    expect((await harness.waitForDiagnostics(schemaUri)).length).toBeGreaterThan(0);

    const cleared = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    hook.set(resolveToNothing);
    harness.notifyConfigChanged();
    expect(await cleared).toEqual([]);
  });

  it('begins diagnosing once a previously unloadable config edit makes inputs live', async () => {
    const hook = mutableResolve(resolveFails);
    harness = startHarness(hook.resolve, watchedFilesCapabilities);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel {',
      },
    });
    await waitUntil(() => configResolutionMock.resolveConfigInputs.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.latestDiagnostics(schemaUri)).toBeUndefined();

    const diagnosed = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length > 0,
    );
    hook.set(resolveToSchema);
    harness.notifyConfigChanged();
    expect((await diagnosed).length).toBeGreaterThan(0);
  });

  it('keeps serving the last-good project when a config edit breaks the config', async () => {
    const hook = mutableResolve(resolveToSchema);
    harness = startHarness(hook.resolve, watchedFilesCapabilities);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: '// use prisma-8\nmodel {',
      },
    });
    const before = await harness.waitForDiagnostics(schemaUri);
    expect(before.length).toBeGreaterThan(0);

    hook.set(resolveFails);
    harness.notifyConfigChanged();

    // Successful loads publish harmless empty clears on the config URI, so
    // wait for the non-empty marker specifically.
    const configDiagnostics = await harness.waitForDiagnosticsMatching(
      configUri,
      (diagnostics) => diagnostics.length > 0,
    );
    expect(configDiagnostics).toHaveLength(1);
    await settle();
    expect(harness.latestDiagnostics(schemaUri)).toEqual(before);
  });
});

describe('language server pull diagnostics', { timeout: timeouts.databaseOperation }, () => {
  it('advertises the diagnostic provider only to clients that support pull diagnostics', async () => {
    harness = startHarness(resolveToSchema, pullDiagnosticsCapabilities);
    const result = await harness.initialize();
    expect(result.capabilities.diagnosticProvider).toEqual({
      interFileDependencies: false,
      workspaceDiagnostics: false,
    });
  });

  it('does not advertise the diagnostic provider to push clients', async () => {
    harness = startHarness(resolveToSchema);
    const result = await harness.initialize();
    expect(result.capabilities.diagnosticProvider).toBeUndefined();
  });

  it('serves a full report through pull without pushing publishDiagnostics', async () => {
    harness = startHarness(resolveToSchema, pullDiagnosticsCapabilities);
    await harness.initialize();
    openDocument(harness, schemaUri, duplicateModelSource);

    const report = await requestPullDiagnostics(harness, schemaUri);
    expect(report.kind).toBe(DocumentDiagnosticReportKind.Full);
    expect(fullReportItems(report).map((diagnostic) => diagnostic.code)).toContain(
      'PSL_DUPLICATE_DECLARATION',
    );
    expect(fullReportItems(report).every((diagnostic) => diagnostic.source === 'prisma')).toBe(
      true,
    );

    await settle();
    expect(harness.publishCount(schemaUri)).toBe(0);
  });

  it('returns an empty report for documents that are not configured inputs', async () => {
    harness = startHarness(resolveToSchema, pullDiagnosticsCapabilities);
    await harness.initialize();
    const otherUri = pathToFileURL(join(root, 'not-a-schema.psl')).toString();
    openDocument(harness, otherUri, duplicateModelSource);

    expect(await requestPullDiagnostics(harness, otherUri)).toEqual({
      kind: DocumentDiagnosticReportKind.Full,
      items: [],
    });
  });

  it('parses lazily on pull after an edit and never pushes to a pull client', async () => {
    harness = startHarness(resolveToSchema, pullDiagnosticsCapabilities);
    await harness.initialize();
    openDocument(harness, schemaUri, '// use prisma-8\nmodel User {\n  id Int @id\n}\n');
    expect(fullReportItems(await requestPullDiagnostics(harness, schemaUri))).toEqual([]);

    pipelineMock.runPipeline.mockClear();
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: duplicateModelSource }],
    });

    const report = await requestPullDiagnostics(harness, schemaUri);
    expect(fullReportItems(report).map((diagnostic) => diagnostic.code)).toContain(
      'PSL_DUPLICATE_DECLARATION',
    );
    expect(pipelineMock.runPipeline).toHaveBeenCalledTimes(1);

    closeDocument(harness, schemaUri);
    await settle();
    expect(harness.publishCount(schemaUri)).toBe(0);
  });

  it('reparses on the next pull after a config reload', async () => {
    harness = startHarness(resolveToSchema, pullDiagnosticsWithRefreshCapabilities);
    await harness.initialize();
    openDocument(harness, schemaUri, duplicateModelSource);
    expect(fullReportItems(await requestPullDiagnostics(harness, schemaUri))).not.toEqual([]);

    pipelineMock.runPipeline.mockClear();
    const refreshed = harness.waitForDiagnosticRefresh();
    harness.notifyConfigChanged();
    await refreshed;

    const report = await requestPullDiagnostics(harness, schemaUri);
    expect(fullReportItems(report).map((diagnostic) => diagnostic.code)).toContain(
      'PSL_DUPLICATE_DECLARATION',
    );
    expect(pipelineMock.runPipeline).toHaveBeenCalledTimes(1);
  });

  it('requests a diagnostics refresh instead of republishing when a config changes', async () => {
    const hook = mutableResolve(resolveToSchema);
    harness = startHarness(hook.resolve, pullDiagnosticsWithRefreshCapabilities);
    await harness.initialize();
    openDocument(harness, schemaUri, duplicateModelSource);
    expect(fullReportItems(await requestPullDiagnostics(harness, schemaUri))).not.toEqual([]);

    const refreshed = harness.waitForDiagnosticRefresh();
    hook.set(resolveToNothing);
    harness.notifyConfigChanged();
    await refreshed;

    expect(fullReportItems(await requestPullDiagnostics(harness, schemaUri))).toEqual([]);
    await settle();
    expect(harness.publishCount(schemaUri)).toBe(0);
  });

  it('does not request a diagnostics refresh when the client lacks refresh support', async () => {
    const hook = mutableResolve(resolveToSchema);
    harness = startHarness(hook.resolve, pullDiagnosticsCapabilities);
    await harness.initialize();
    openDocument(harness, schemaUri, duplicateModelSource);
    await requestPullDiagnostics(harness, schemaUri);

    hook.set(resolveToNothing);
    harness.notifyConfigChanged();
    await settle();

    expect(harness.diagnosticRefreshCount()).toBe(0);
    expect(harness.publishCount(schemaUri)).toBe(0);
  });
});

describe('language server project lifecycle', { timeout: timeouts.databaseOperation }, () => {
  it('drops the project when its last open input closes and reopening re-evaluates the config', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    openDocument(harness, schemaUri, duplicateModelSource);
    expect((await harness.waitForDiagnostics(schemaUri)).length).toBeGreaterThan(0);
    expect(configResolutionMock.resolveConfigInputs).toHaveBeenCalledTimes(1);

    const cleared = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    closeDocument(harness, schemaUri);
    await cleared;

    const rediagnosed = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length > 0,
    );
    openDocument(harness, schemaUri, duplicateModelSource, 2);
    await rediagnosed;
    expect(configResolutionMock.resolveConfigInputs).toHaveBeenCalledTimes(2);
  });

  it('keeps the project while another open input remains', async () => {
    const schema2Path = join(root, 'schema2.psl');
    const schema2Uri = pathToFileURL(schema2Path).toString();
    harness = startHarness(async () => resolutionForInputs([schemaPath, schema2Path]));
    await harness.initialize();
    openDocument(harness, schemaUri, duplicateModelSource);
    expect((await harness.waitForDiagnostics(schemaUri)).length).toBeGreaterThan(0);
    openDocument(harness, schema2Uri, formattedPsl);
    expect(await harness.waitForDiagnostics(schema2Uri)).toEqual([
      expect.objectContaining({ code: 'PSL_DUPLICATE_DECLARATION' }),
    ]);

    const cleared = harness.waitForDiagnosticsMatching(
      schema2Uri,
      (diagnostics) => diagnostics.length === 0,
    );
    closeDocument(harness, schema2Uri);
    await cleared;

    await expect(requestSemanticTokens(harness, schemaUri)).resolves.not.toEqual({ data: [] });
    expect(configResolutionMock.resolveConfigInputs).toHaveBeenCalledTimes(1);
  });

  it('leaves no project behind when only a stray document was opened', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const otherUri = pathToFileURL(join(root, 'not-a-schema.psl')).toString();
    openDocument(harness, otherUri, formattedPsl);
    await settle();
    expect(configResolutionMock.resolveConfigInputs).toHaveBeenCalledTimes(1);

    const diagnosed = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length > 0,
    );
    openDocument(harness, schemaUri, duplicateModelSource);
    await diagnosed;
    expect(configResolutionMock.resolveConfigInputs).toHaveBeenCalledTimes(2);
  });

  it('keeps the project when a stray document opens beside an open input', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    openDocument(harness, schemaUri, duplicateModelSource);
    expect((await harness.waitForDiagnostics(schemaUri)).length).toBeGreaterThan(0);

    const otherUri = pathToFileURL(join(root, 'not-a-schema.psl')).toString();
    openDocument(harness, otherUri, formattedPsl);
    await settle();

    await expect(requestSemanticTokens(harness, schemaUri)).resolves.not.toEqual({ data: [] });
    expect(configResolutionMock.resolveConfigInputs).toHaveBeenCalledTimes(1);
  });

  it('does not reload a dropped project when its config changes', async () => {
    harness = startHarness(resolveToSchema, watchedFilesCapabilities);
    await harness.initialize();
    openDocument(harness, schemaUri, duplicateModelSource);
    expect((await harness.waitForDiagnostics(schemaUri)).length).toBeGreaterThan(0);

    const cleared = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    closeDocument(harness, schemaUri);
    await cleared;

    harness.notifyConfigChanged();
    await settle();
    expect(configResolutionMock.resolveConfigInputs).toHaveBeenCalledTimes(1);
  });
});

describe('language server preserved artifacts', { timeout: timeouts.databaseOperation }, () => {
  it('replaces the cached AST per URI on each edit while one symbol table tracks the project', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: duplicateModelSource,
      },
    });
    const broken = await harness.waitForDiagnostics(schemaUri);
    expect(broken.map((diagnostic) => diagnostic.code)).toContain('PSL_DUPLICATE_DECLARATION');
    const firstAst = harness.getDocumentAst(schemaUri);
    expect(firstAst?.document).toBeDefined();

    const cleared = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [
        {
          text: '// use prisma-8\nmodel User {\n  id Int @id\n}\n\nmodel Post {\n  id Int @id\n}\n',
        },
      ],
    });
    await cleared;

    const secondAst = harness.getDocumentAst(schemaUri);
    expect(secondAst?.document).not.toBe(firstAst?.document);
    expect(Object.keys(harness.getProjectSymbolTable(schemaUri)?.topLevel.models ?? {})).toEqual(
      expect.arrayContaining(['User', 'Post']),
    );
  });

  it('ignores a publish that resolves after the document closes', async () => {
    const load = deferred<ConfigResolution>();
    harness = startHarness(async () => load.promise);
    await harness.initialize();

    openDocument(harness, schemaUri, duplicateModelSource);
    const closed = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    closeDocument(harness, schemaUri);
    await closed;

    load.resolve(resolutionForInputs([schemaPath]));
    await requestFormatting(harness, schemaUri);

    expect(harness.latestDiagnostics(schemaUri)).toEqual([]);
    expect(harness.getDocumentAst(schemaUri)).toBeUndefined();
    expect(harness.getProjectSymbolTable(schemaUri)).toBeUndefined();
  });

  it('rediscovers document ownership after close', async () => {
    const alternateConfigPath = join(root, 'alternate-prisma.config.ts');
    let nearestConfigPath = configPath;
    harness = startHarness(
      async (path) => (path === configPath ? resolutionForInputs([schemaPath]) : emptyResolution()),
      {},
      async () => nearestConfigPath,
    );
    await harness.initialize();

    openDocument(harness, schemaUri, duplicateModelSource);
    expect((await harness.waitForDiagnostics(schemaUri)).length).toBeGreaterThan(0);

    const closed = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    closeDocument(harness, schemaUri);
    await closed;

    nearestConfigPath = alternateConfigPath;
    openDocument(harness, schemaUri, duplicateModelSource, 2);
    await waitUntil(() =>
      configResolutionMock.resolveConfigInputs.mock.calls.some(
        ([path]) => path === alternateConfigPath,
      ),
    );
  });

  it('drops the cached AST and clears the symbol table when the document closes', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    // Open with a diagnostic-producing source so the only empty publish is the
    // close's clear.
    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: duplicateModelSource,
      },
    });
    expect((await harness.waitForDiagnostics(schemaUri)).length).toBeGreaterThan(0);
    expect(harness.getDocumentAst(schemaUri)).toBeDefined();
    expect(harness.getProjectSymbolTable(schemaUri)).toBeDefined();
    expect(harness.publishCount(schemaUri)).toBe(1);

    const closed = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    harness.client.sendNotification(DidCloseTextDocumentNotification.type, {
      textDocument: { uri: schemaUri },
    });
    await closed;

    expect(harness.getDocumentAst(schemaUri)).toBeUndefined();
    expect(harness.getProjectSymbolTable(schemaUri)).toBeUndefined();
  });
});

describe('language server disposal', { timeout: timeouts.databaseOperation }, () => {
  it.each([
    { method: RegistrationRequest.method, capabilities: watchedFilesCapabilities },
    {
      method: DiagnosticRefreshRequest.method,
      capabilities: pullDiagnosticsWithRefreshCapabilities,
    },
  ])(
    'finishes an outstanding $method response before disposing the transport',
    async ({ method, capabilities }) => {
      const entered = deferred<void>();
      const response = deferred<void>();
      harness = startHarness(resolveToSchema, capabilities);
      harness.client.onRequest(method, () => {
        entered.resolve();
        return response.promise;
      });
      let disposed = false;
      await harness.initialize();
      harness.notifyConfigChanged();
      await entered.promise;

      const disposal = harness.dispose().then(() => {
        disposed = true;
      });
      await requestFormatting(harness, schemaUri);
      const disposedBeforeResponse = disposed;
      response.resolve();
      await disposal;
      harness = undefined;

      expect(disposedBeforeResponse).toBe(false);
      expect(disposed).toBe(true);
    },
  );

  async function assertNoUnhandledRejection(
    settle: (load: {
      readonly resolve: (value: ConfigResolution) => void;
      readonly reject: (reason: unknown) => void;
    }) => void,
  ): Promise<void> {
    const load = deferredSettleable<ConfigResolution>();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      harness = startHarness(async () => load.promise);
      await harness.initialize();

      openDocument(harness, schemaUri, duplicateModelSource);
      await waitUntil(() => configResolutionMock.resolveConfigInputs.mock.calls.length > 0);

      harness.disconnect();
      harness = undefined;

      settle(load);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  }

  it('does not reject when an in-flight publish resolves after dispose', async () => {
    await assertNoUnhandledRejection((load) => load.resolve(resolutionForInputs([schemaPath])));
  });

  it('does not reject when an in-flight publish rejects after dispose', async () => {
    await assertNoUnhandledRejection((load) =>
      load.reject(new Error('config load failed after dispose')),
    );
  });

  it('does not reject when a client notification is still being written at dispose', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      harness = startHarness(resolveToSchema);
      await harness.initialize();
      openDocument(harness, schemaUri, duplicateModelSource);
      await harness.waitForDiagnostics(schemaUri);

      // The write is queued behind the writer's own semaphore, so ending the
      // transport in the same tick fails it after the connection is disposed:
      // jsonrpc then reports the failed write through the connection's console,
      // which is one more send on a disposed connection.
      harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri: schemaUri, version: 2 },
        contentChanges: [{ text: duplicateModelSource }],
      });
      harness.disconnect();
      harness = undefined;

      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('language server interpreter diagnostics', { timeout: timeouts.databaseOperation }, () => {
  const cleanSchema = '// use prisma-8\nmodel User {\n  id Int @id\n}\n';
  const fixedSchema = '// use prisma-8\nmodel User {\n  id Int @id\n}\n// fixed\n';
  // Span covers "User" on the line after the directive: 1-based columns 7..11
  // map to the 0-based LSP range {1,6}..{1,10}.
  const unresolvedDiagnostic = {
    code: 'PSL_UNRESOLVED_RELATION',
    message: 'relation target not found',
    sourceId: schemaUri,
    span: { start: { offset: 22, line: 2, column: 7 }, end: { offset: 26, line: 2, column: 11 } },
  };
  const expectedUnresolved: Diagnostic = {
    range: { start: { line: 1, character: 6 }, end: { line: 1, character: 10 } },
    message: 'relation target not found',
    code: 'PSL_UNRESOLVED_RELATION',
    severity: DiagnosticSeverity.Error,
    source: 'prisma',
  };

  function interpretationResolution(interpret: PslInterpretCapable['interpret']): {
    readonly resolveInputs: ResolveInputs;
    readonly spy: ReturnType<typeof vi.fn>;
  } {
    const spy = vi.fn(interpret);
    const source = {
      format: 'psl',
      inputs: [schemaPath],
      load: async () => ok({} as never),
      interpret: spy,
    } as unknown as PslInterpretCapable;
    const resolution: ConfigResolution = {
      ...resolutionForInputs([schemaPath]),
      interpretation: { source, context: {} as unknown as ContractSourceContext },
    };
    return { resolveInputs: async () => resolution, spy };
  }

  function fixAwareInterpret(): PslInterpretCapable['interpret'] {
    return (input: PslInterpretInput) =>
      input.sources.sourceFileFor(input.document.syntax).text.includes('// fixed')
        ? ok({} as never)
        : notOk({ summary: 'Schema has 1 error', diagnostics: [unresolvedDiagnostic] });
  }

  it('recovers from an interpreter exception on a same-version pull and logs its original stack', async () => {
    const error = new Error('private interpreter detail');
    const { resolveInputs, spy } = interpretationResolution(() => ok({} as never));
    spy.mockImplementationOnce(() => {
      throw error;
    });
    harness = startHarness(resolveInputs, pullDiagnosticsCapabilities);
    const logs: string[] = [];
    harness.client.onNotification(LogMessageNotification.type, (params) => {
      if (params.type === MessageType.Error) logs.push(params.message);
    });
    await harness.initialize();
    openDocument(harness, schemaUri, duplicateModelSource);
    const { parseDiagnostics, symbolTableDiagnostics } =
      parseAndSymbolTableDiagnostics(duplicateModelSource);
    const parserItems = toPublishedDiagnostics([...parseDiagnostics, ...symbolTableDiagnostics]);
    expect(fullReportItems(await requestPullDiagnostics(harness, schemaUri))).toEqual([
      ...parserItems,
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        code: 'PRISMA_NEXT_INTERPRETATION_FAILED',
        message:
          'Semantic diagnostics are unavailable because of an internal error. A subsequent diagnostic request or edit will retry.',
        severity: DiagnosticSeverity.Error,
        source: 'prisma',
      },
    ]);
    expect(logs).toEqual([`PSL interpretation failed for ${schemaUri}: ${error.stack}`]);
    expect(fullReportItems(await requestPullDiagnostics(harness, schemaUri))).toEqual(parserItems);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('recovers diagnostics after edits for pull=%s', async (pull) => {
    const interpret = fixAwareInterpret();
    const { resolveInputs } = interpretationResolution((input, context) => {
      if (input.sources.sourceFileFor(input.document.syntax).text.includes('// crash'))
        throw new Error('interpreter failed');
      return interpret(input, context);
    });
    harness = startHarness(resolveInputs, pull ? pullDiagnosticsCapabilities : {});
    await harness.initialize();
    openDocument(harness, schemaUri, `${cleanSchema}// crash`);
    const failed = pull
      ? fullReportItems(await requestPullDiagnostics(harness, schemaUri))
      : await harness.waitForDiagnostics(schemaUri);
    expect(failed.map((item) => item.code)).toEqual(['PRISMA_NEXT_INTERPRETATION_FAILED']);
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: cleanSchema }],
    });
    const recovered = pull
      ? fullReportItems(await requestPullDiagnostics(harness, schemaUri))
      : await harness.waitForDiagnosticsMatching(schemaUri, (items) =>
          items.some((item) => item.code === expectedUnresolved.code),
        );
    expect(recovered).toEqual([expectedUnresolved]);
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 3 },
      contentChanges: [{ text: fixedSchema }],
    });
    const fixed = pull
      ? fullReportItems(await requestPullDiagnostics(harness, schemaUri))
      : await harness.waitForDiagnosticsMatching(schemaUri, (items) => items.length === 0);
    expect(fixed).toEqual([]);
  });

  it('pull serves the interpreter diagnostic at its mapped range and clears it after a fix', async () => {
    const { resolveInputs } = interpretationResolution(fixAwareInterpret());
    harness = startHarness(resolveInputs, pullDiagnosticsCapabilities);
    await harness.initialize();
    openDocument(harness, schemaUri, cleanSchema);

    const report = await requestPullDiagnostics(harness, schemaUri);
    expect(fullReportItems(report)).toEqual([expectedUnresolved]);

    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: fixedSchema }],
    });

    const fixedReport = await requestPullDiagnostics(harness, schemaUri);
    expect(fullReportItems(fixedReport)).toEqual([]);
  });

  it('push publishes the combined parse and interpreter diagnostics', async () => {
    const { resolveInputs } = interpretationResolution(fixAwareInterpret());
    harness = startHarness(resolveInputs);
    await harness.initialize();
    openDocument(harness, schemaUri, cleanSchema);

    const published = await harness.waitForDiagnostics(schemaUri);
    expect(published).toEqual([expectedUnresolved]);
  });

  it('anchors a span-less interpreter diagnostic at document start', async () => {
    const { resolveInputs } = interpretationResolution(() =>
      notOk({
        summary: 'Schema has 1 error',
        diagnostics: [{ code: 'PSL_SPANLESS', message: 'no span available', sourceId: schemaUri }],
      }),
    );
    harness = startHarness(resolveInputs, pullDiagnosticsCapabilities);
    await harness.initialize();
    openDocument(harness, schemaUri, cleanSchema);

    const report = await requestPullDiagnostics(harness, schemaUri);
    expect(fullReportItems(report)).toEqual([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        message: 'no span available',
        code: 'PSL_SPANLESS',
        severity: DiagnosticSeverity.Error,
        source: 'prisma',
      },
    ]);
  });

  it('capability-less configs pull exactly the pre-slice response', async () => {
    harness = startHarness(resolveToSchema, pullDiagnosticsCapabilities);
    await harness.initialize();
    openDocument(harness, schemaUri, duplicateModelSource);

    const { parseDiagnostics, symbolTableDiagnostics } =
      parseAndSymbolTableDiagnostics(duplicateModelSource);
    const report = await requestPullDiagnostics(harness, schemaUri);
    expect(fullReportItems(report)).toEqual(
      toPublishedDiagnostics([...parseDiagnostics, ...symbolTableDiagnostics]),
    );
  });

  it('capability-less configs publish exactly the pre-slice response', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    openDocument(harness, schemaUri, duplicateModelSource);

    const { parseDiagnostics, symbolTableDiagnostics } =
      parseAndSymbolTableDiagnostics(duplicateModelSource);
    const published = await harness.waitForDiagnostics(schemaUri);
    expect(published).toEqual(
      toPublishedDiagnostics([...parseDiagnostics, ...symbolTableDiagnostics]),
    );
  });

  it('interprets only for diagnostics: never for tokens, folding, or completion; memoized per version', async () => {
    const { resolveInputs, spy } = interpretationResolution(fixAwareInterpret());
    harness = startHarness(resolveInputs, pullDiagnosticsCapabilities);
    await harness.initialize();
    openDocument(harness, schemaUri, cleanSchema);

    await requestSemanticTokens(harness, schemaUri);
    await requestFoldingRanges(harness, schemaUri);
    await requestCompletion(harness, schemaUri, { line: 1, character: 2 });
    expect(spy).not.toHaveBeenCalled();

    await requestPullDiagnostics(harness, schemaUri);
    await requestPullDiagnostics(harness, schemaUri);
    expect(spy).toHaveBeenCalledTimes(1);

    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: fixedSchema }],
    });
    await requestPullDiagnostics(harness, schemaUri);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('language server config failure surfacing', {
  timeout: timeouts.databaseOperation,
}, () => {
  const cleanSchema = '// use prisma-8\nmodel User {\n  id Int @id\n}\n';
  const expectedConfigFailure = (message: string): Diagnostic => ({
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    message,
    code: CONFIG_LOAD_FAILED_CODE,
    severity: DiagnosticSeverity.Error,
    source: 'prisma',
  });

  function interpretingResolution(): ConfigResolution {
    const source = {
      format: 'psl',
      inputs: [schemaPath],
      load: async () => ok({} as never),
      interpret: () =>
        notOk({
          summary: 'Schema has 1 error',
          diagnostics: [
            { code: 'PSL_INTERPRETER_FINDING', message: 'finding', sourceId: schemaUri },
          ],
        }),
    } as unknown as PslInterpretCapable;
    return {
      ...resolutionForInputs([schemaPath]),
      interpretation: { source, context: {} as unknown as ContractSourceContext },
    };
  }

  it('publishes one config diagnostic on first-load failure and leaves the document unmanaged', async () => {
    harness = startHarness(async () => {
      throw new Error('config exploded');
    });
    await harness.initialize();
    openDocument(harness, schemaUri, cleanSchema);

    const published = await harness.waitForDiagnostics(configUri);
    expect(published).toEqual([expectedConfigFailure('config exploded')]);
    expect(harness.getDocumentAst(schemaUri)).toBeUndefined();

    await settle();
    expect(harness.latestDiagnostics(configUri)).toEqual([
      expectedConfigFailure('config exploded'),
    ]);
  });

  it('publishes the structured error why text instead of the generic envelope title', async () => {
    harness = startHarness(async () => {
      throw errorUnexpected('boom', { why: 'Failed to load config: boom' });
    });
    await harness.initialize();
    openDocument(harness, schemaUri, cleanSchema);

    const published = await harness.waitForDiagnostics(configUri);
    expect(published).toEqual([expectedConfigFailure('Failed to load config: boom')]);
  });

  it('publishes the config diagnostic exactly once when two documents await the same load', async () => {
    const otherPath = join(root, 'other.psl');
    const otherUri = pathToFileURL(otherPath).toString();
    const gate = deferredSettleable<ConfigResolution>();
    harness = startHarness(() => gate.promise);
    await harness.initialize();
    openDocument(harness, schemaUri, cleanSchema);
    openDocument(harness, otherUri, cleanSchema);
    // Both open notifications are processed before the shared load settles.
    await settle();
    gate.reject(new Error('config exploded'));

    await harness.waitForDiagnostics(configUri);
    await settle();
    expect(harness.nonEmptyPublishCount(configUri)).toBe(1);
  });

  it('publishes the config diagnostic even for pull-capable clients', async () => {
    harness = startHarness(async () => {
      throw new Error('config exploded');
    }, pullDiagnosticsCapabilities);
    await harness.initialize();
    openDocument(harness, schemaUri, cleanSchema);
    // Pull clients trigger project resolution through the pull request.
    const report = await requestPullDiagnostics(harness, schemaUri);
    expect(fullReportItems(report)).toEqual([]);

    const published = await harness.waitForDiagnostics(configUri);
    expect(published).toEqual([expectedConfigFailure('config exploded')]);
  });

  it('clears the config diagnostic on the next successful load', async () => {
    let failures = 1;
    harness = startHarness(async () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('config exploded');
      }
      return resolutionForInputs([schemaPath]);
    });
    await harness.initialize();
    openDocument(harness, schemaUri, cleanSchema);
    await harness.waitForDiagnostics(configUri);

    harness.notifyConfigChanged();

    await harness.waitForDiagnosticsMatching(configUri, (diagnostics) => diagnostics.length === 0);
    expect(harness.latestDiagnostics(configUri)).toEqual([]);
  });

  it('keeps serving the last-good project through a broken reload, then swaps in the fix', async () => {
    let mode: 'good' | 'broken' | 'fixed' = 'good';
    harness = startHarness(async () => {
      if (mode === 'broken') {
        throw new Error('config exploded');
      }
      return interpretingResolution();
    }, pullDiagnosticsCapabilities);
    await harness.initialize();
    openDocument(harness, schemaUri, cleanSchema);

    const before = await requestPullDiagnostics(harness, schemaUri);
    expect(fullReportItems(before).map((d) => d.code)).toContain('PSL_INTERPRETER_FINDING');

    mode = 'broken';
    harness.notifyConfigChanged();
    const failure = await harness.waitForDiagnosticsMatching(
      configUri,
      (diagnostics) => diagnostics.length > 0,
    );
    expect(failure).toEqual([expectedConfigFailure('config exploded')]);

    const retained = await requestPullDiagnostics(harness, schemaUri);
    expect(fullReportItems(retained).map((d) => d.code)).toContain('PSL_INTERPRETER_FINDING');

    mode = 'fixed';
    harness.notifyConfigChanged();
    await harness.waitForDiagnosticsMatching(configUri, (diagnostics) => diagnostics.length === 0);

    const after = await requestPullDiagnostics(harness, schemaUri);
    expect(fullReportItems(after).map((d) => d.code)).toContain('PSL_INTERPRETER_FINDING');
  });

  it.each(['edit', 'close'])(
    'invalidates last-good source roots on %s during a failed reload',
    async (event) => {
      const siblingPath = join(root, 'sibling.psl');
      const siblingUri = pathToFileURL(siblingPath).toString();
      const resolution = {
        ...interpretingResolution(),
        inputs: resolveSchemaInputs({
          contract: { source: { format: 'psl', inputs: [schemaPath, siblingPath] } },
        }),
      };
      const spy = vi.spyOn(resolution.interpretation!.source, 'interpret');
      const gate = deferredSettleable<ConfigResolution>();
      let calls = 0;
      harness = startHarness(() => {
        calls += 1;
        return calls === 1 ? Promise.resolve(resolution) : gate.promise;
      }, pullDiagnosticsCapabilities);
      await harness.initialize();
      openDocument(harness, schemaUri, cleanSchema);
      await requestPullDiagnostics(harness, schemaUri);
      openDocument(harness, siblingUri, cleanSchema);
      await requestPullDiagnostics(harness, siblingUri);
      const previous = spy.mock.calls.at(-1)![0];

      harness.notifyConfigChanged();
      await waitUntil(() => calls === 2);
      if (event === 'close') {
        closeDocument(harness, siblingUri);
      } else {
        harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
          textDocument: { uri: siblingUri, version: 2 },
          contentChanges: [{ text: `${cleanSchema}\nmodel Post {\n id Int\n}\n` }],
        });
      }
      await settle();
      gate.reject(new Error('config exploded'));
      await harness.waitForDiagnosticsMatching(configUri, (diagnostics) => diagnostics.length > 0);
      if (event === 'edit') {
        await requestPullDiagnostics(harness, siblingUri);
      }
      await requestPullDiagnostics(harness, schemaUri);
      const current = spy.mock.calls.at(-1)![0];
      expect(() => current.sources.sourceFileFor(previous.document.syntax)).toThrow(
        /No SourceFile/,
      );
      expect(current.sources.sourceFileFor(current.document.syntax).filename).toBe(schemaUri);
      expect(current.document).toBe(spy.mock.calls[0]![0].document);
    },
  );

  it('clears the config diagnostic when the last managed document closes', async () => {
    let broken = false;
    harness = startHarness(async () => {
      if (broken) {
        throw new Error('config exploded');
      }
      return resolutionForInputs([schemaPath]);
    });
    await harness.initialize();
    openDocument(harness, schemaUri, cleanSchema);
    await harness.waitForDiagnostics(schemaUri);

    broken = true;
    harness.notifyConfigChanged();
    await harness.waitForDiagnostics(configUri);

    harness.client.sendNotification(DidCloseTextDocumentNotification.type, {
      textDocument: { uri: schemaUri },
    });

    await harness.waitForDiagnosticsMatching(configUri, (diagnostics) => diagnostics.length === 0);
  });

  it('drops the project without resurrection or zombie marker when a reload fails after the last document closed', async () => {
    const gate = deferredSettleable<ConfigResolution>();
    let call = 0;
    harness = startHarness(() => {
      call += 1;
      return call === 1 ? Promise.resolve(resolutionForInputs([schemaPath])) : gate.promise;
    });
    await harness.initialize();
    openDocument(harness, schemaUri, cleanSchema);
    await harness.waitForDiagnostics(schemaUri);

    harness.notifyConfigChanged();
    await settle();
    harness.client.sendNotification(DidCloseTextDocumentNotification.type, {
      textDocument: { uri: schemaUri },
    });
    await settle();
    gate.reject(new Error('config exploded'));
    await settle();

    expect(harness.nonEmptyPublishCount(configUri)).toBe(0);
    expect(harness.latestDiagnostics(configUri) ?? []).toEqual([]);
  });

  it('leaves a newer load untouched when a superseded load fails', async () => {
    const first = deferredSettleable<ConfigResolution>();
    let calls = 0;
    harness = startHarness(() => {
      calls += 1;
      return calls === 1 ? first.promise : Promise.resolve(resolutionForInputs([schemaPath]));
    });
    await harness.initialize();
    openDocument(harness, schemaUri, cleanSchema);
    harness.notifyConfigChanged();
    await settle();
    first.reject(new Error('superseded failure'));

    const published = await harness.waitForDiagnostics(schemaUri);
    expect(published).toEqual([]);
    await settle();
    expect(harness.nonEmptyPublishCount(configUri)).toBe(0);
    expect(harness.getDocumentAst(schemaUri)).toBeDefined();
    // The newer load's result serves directly — no rediscovery reload churn.
    expect(calls).toBe(2);
  });

  it('stays silent for a superseded load failure', async () => {
    const first = deferredSettleable<ConfigResolution>();
    let call = 0;
    harness = startHarness(() => {
      call += 1;
      return call === 1 ? first.promise : Promise.resolve(resolutionForInputs([schemaPath]));
    });
    await harness.initialize();
    openDocument(harness, schemaUri, cleanSchema);

    harness.notifyConfigChanged();
    // The watched-config handler swaps the current load synchronously before
    // its first await; settling lets that notification dispatch, so the
    // rejection below lands on a superseded load.
    await settle();
    first.reject(new Error('superseded failure'));

    await harness.waitForDiagnostics(schemaUri);
    await settle();
    expect(harness.nonEmptyPublishCount(configUri)).toBe(0);
  });
});

describe('project symbol diagnostics assembly', () => {
  it.each(['push', 'pull'] as const)(
    'routes cross-file duplicates once to their owning document over %s',
    async (mode) => {
      const siblingPath = join(root, 'sibling.psl');
      const siblingUri = pathToFileURL(siblingPath)
        .toString()
        .replace('sibling.psl', '%73ibling.psl');
      harness = startHarness(
        async () => resolutionForInputs([schemaPath, siblingPath]),
        mode === 'pull' ? pullDiagnosticsCapabilities : undefined,
      );
      await harness.initialize();
      const source = '// use prisma-8\nmodel User {\n  id Int @id\n}\n';
      openDocument(harness, schemaUri, source);
      if (mode === 'push') await harness.waitForDiagnostics(schemaUri);
      else await requestPullDiagnostics(harness, schemaUri);
      openDocument(harness, siblingUri, source);
      const expected = [
        {
          code: 'PSL_DUPLICATE_DECLARATION',
          message: 'Duplicate declaration of "User"',
          severity: DiagnosticSeverity.Error,
          source: 'prisma',
          range: { start: { line: 1, character: 6 }, end: { line: 1, character: 10 } },
        },
      ];
      if (mode === 'push') {
        expect(await harness.waitForDiagnostics(siblingUri)).toEqual(expected);
        expect(harness.latestDiagnostics(schemaUri)).toEqual([]);
      } else {
        expect(await requestPullDiagnostics(harness, siblingUri)).toEqual({
          kind: DocumentDiagnosticReportKind.Full,
          items: expected,
        });
        expect(await requestPullDiagnostics(harness, schemaUri)).toEqual({
          kind: DocumentDiagnosticReportKind.Full,
          items: [],
        });
      }
      expect(harness.getDocumentAst(siblingUri)?.diagnostics).toEqual([]);
    },
  );
});

describe('language server prisma-8 directive gating', {
  timeout: timeouts.databaseOperation,
}, () => {
  const unmarkedDuplicate = [
    'model User {',
    '  id Int @id',
    '}',
    '',
    'model User {',
    '  id Int @id',
    '}',
    '',
  ].join('\n');
  const markedDuplicate = `// use prisma-8\n${unmarkedDuplicate}`;

  it('publishes empty diagnostics and answers no feature requests for an unmarked configured input', async () => {
    harness = startHarness(resolveToSchemaWithPslBlockDescriptors);
    await harness.initialize();

    openDocument(harness, schemaUri, unmarkedDuplicate);
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);
    expect(harness.publishCount(schemaUri)).toBeGreaterThan(0);

    const items = completionItems(
      await requestCompletion(harness, schemaUri, { line: 0, character: 0 }),
    );
    expect(items).toEqual([]);
    await expect(requestSemanticTokens(harness, schemaUri)).resolves.toEqual({ data: [] });
    await expect(requestFoldingRanges(harness, schemaUri)).resolves.toEqual([]);
    expect(harness.getDocumentAst(schemaUri)).toBeUndefined();
    expect(harness.getProjectSymbolTable(schemaUri)).toBeUndefined();
  });

  it('returns no formatting edits for an unmarked configured input', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    openDocument(harness, schemaUri, 'model User {\nid Int\n}');
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);

    await expect(requestFormatting(harness, schemaUri)).resolves.toEqual([]);
  });

  it('serves an empty pull report for an unmarked configured input', async () => {
    harness = startHarness(resolveToSchema, pullDiagnosticsCapabilities);
    await harness.initialize();

    openDocument(harness, schemaUri, unmarkedDuplicate);
    expect(await requestPullDiagnostics(harness, schemaUri)).toEqual({
      kind: DocumentDiagnosticReportKind.Full,
      items: [],
    });
  });

  it('publishes empty diagnostics and stops answering once an edit removes the directive', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    openDocument(harness, schemaUri, markedDuplicate);
    const before = await harness.waitForDiagnostics(schemaUri);
    expect(before.map((diagnostic) => diagnostic.code)).toContain('PSL_DUPLICATE_DECLARATION');

    const cleared = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: unmarkedDuplicate }],
    });
    expect(await cleared).toEqual([]);

    await expect(requestSemanticTokens(harness, schemaUri)).resolves.toEqual({ data: [] });
    await expect(requestFoldingRanges(harness, schemaUri)).resolves.toEqual([]);
    expect(harness.getDocumentAst(schemaUri)).toBeUndefined();
  });

  it('begins diagnosing from the edited content once an edit adds the directive', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    openDocument(harness, schemaUri, unmarkedDuplicate);
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);

    const diagnosed = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length > 0,
    );
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: markedDuplicate }],
    });
    expect((await diagnosed).map((diagnostic) => diagnostic.code)).toContain(
      'PSL_DUPLICATE_DECLARATION',
    );

    const tokens = await requestSemanticTokens(harness, schemaUri);
    expect(tokens?.data.length).toBeGreaterThan(0);
  });

  it('excludes an unmarked sibling input from schema composition', async () => {
    const schema2Path = join(root, 'schema2.psl');
    const schema2Uri = pathToFileURL(schema2Path).toString();
    harness = startHarness(async () => resolutionForInputs([schemaPath, schema2Path]));
    await harness.initialize();

    openDocument(harness, schemaUri, '// use prisma-8\nmodel User {\n  id Int @id\n}\n');
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);
    openDocument(harness, schema2Uri, 'model Stray {\n  id Int @id\n}\n');
    expect(await harness.waitForDiagnostics(schema2Uri)).toEqual([]);

    const models = Object.keys(harness.getProjectSymbolTable(schemaUri)?.topLevel.models ?? {});
    expect(models).toContain('User');
    expect(models).not.toContain('Stray');
    expect(harness.getDocumentAst(schema2Uri)).toBeUndefined();
    expect(harness.getProjectSymbolTable(schema2Uri)).toBeUndefined();
  });
});
