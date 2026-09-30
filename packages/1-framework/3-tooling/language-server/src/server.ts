import { fileURLToPath } from 'node:url';
import { findNearestConfigPathForFile } from '@internal/config-loader';
import { isPrismaNextSchema, type SymbolTable } from '@internal/psl-parser';
import { join } from 'pathe';
import {
  type CompletionItem,
  type Connection,
  DidChangeWatchedFilesNotification,
  type DocumentDiagnosticReport,
  DocumentDiagnosticReportKind,
  type FoldingRange,
  type InitializeParams,
  type InitializeResult,
  type Position,
  type Range,
  RegistrationRequest,
  type SemanticTokens,
  type SignatureHelp,
  TextDocumentSyncKind,
  type TextEdit,
} from 'vscode-languageserver';
import { CONFIG_FILENAME } from './config-resolution';
import type { DocumentSnapshot } from './document-snapshot';
import { DocumentStore } from './document-store';
import { guardedConnection } from './guarded-connection';
import { Project } from './project';
import type { ProjectArtifacts } from './project-artifacts';
import { canonicalFileIdentity, normalizeFileUri } from './schema-inputs';
import { semanticTokensLegend } from './semantic-tokens';

export interface LanguageServer {
  dispose(): void;
  getDocumentAst(uri: string): DocumentSnapshot | undefined;
  getProjectSymbolTable(uri: string): SymbolTable | undefined;
}

const semanticTokenSourceLimit = 100_000;

export function createServer(connection: Connection): LanguageServer {
  return createServerOn(guardedConnection(connection));
}

function createServerOn(connection: Connection): LanguageServer {
  const documents = new DocumentStore();
  const { getOpenDocument } = documents;
  const projectsByConfig = new Map<string, Project>();
  const documentConfigPaths = new Map<string, string>();
  let membershipGeneration = 0;
  let rootPath = process.cwd();
  let watchedConfigGlob = join(rootPath, '**', CONFIG_FILENAME);
  let clientCapabilities = noClientCapabilities;

  async function projectForNearestConfig(uri: string): Promise<Project | undefined> {
    const knownConfigPath = documentConfigPaths.get(canonicalFileIdentity(uri));
    if (knownConfigPath !== undefined) return projectForConfig(knownConfigPath);
    const filePath = filePathFromUri(uri);
    if (filePath === undefined) return undefined;
    let configPath: string | undefined;
    try {
      configPath = await findNearestConfigPathForFile(filePath);
    } catch {
      return undefined;
    }
    if (configPath === undefined) return undefined;
    documentConfigPaths.set(canonicalFileIdentity(uri), configPath);
    return projectForConfig(configPath);
  }

  function projectForConfig(configPath: string): Project {
    let project = projectsByConfig.get(configPath);
    if (project === undefined) {
      project = new Project(configPath, {
        documents,
        connection,
        pullDiagnostics: clientCapabilities.pullDiagnostics,
        watchedFilesRegistration: clientCapabilities.watchedFilesRegistration,
        nextSequence: () => ++membershipGeneration,
        unmanage: (uri) => {
          if (uri === undefined) unmanageDocuments(configPath);
          else documentConfigPaths.delete(canonicalFileIdentity(uri));
        },
      });
      projectsByConfig.set(configPath, project);
    }
    return project;
  }

  function unmanageDocuments(configPath: string): void {
    for (const document of documents.openDocuments()) {
      if (documentConfigPaths.get(canonicalFileIdentity(document.uri)) === configPath) {
        documentConfigPaths.delete(canonicalFileIdentity(document.uri));
      }
    }
  }

  async function publishForDocument(uri: string): Promise<void> {
    const project = await projectForNearestConfig(uri);
    await project?.publishForDocument(uri);
  }

  function publishForDocumentSafely(uri: string): void {
    void publishForDocument(uri).catch((error: unknown) => {
      connection.console.error(error instanceof Error ? error.message : String(error));
    });
  }

  async function formatDocument(uri: string): Promise<TextEdit[]> {
    const document = getOpenDocument(uri);
    if (document === undefined) return [];
    const source = document.getText();
    if (!isPrismaNextSchema(source)) return [];
    const project = await projectForNearestConfig(uri);
    const formatted = await project?.formatDocument(uri, source);
    if (formatted === undefined || formatted === source) return [];
    return [
      {
        range: { start: { line: 0, character: 0 }, end: document.positionAt(source.length) },
        newText: formatted,
      },
    ];
  }

  async function semanticTokensForDocument(uri: string, range?: Range): Promise<SemanticTokens> {
    const document = getOpenDocument(uri);
    if (document === undefined) return emptySemanticTokens();
    const text = document.getText();
    if (text.length > semanticTokenSourceLimit) return emptySemanticTokens();
    const project = await projectForNearestConfig(uri);
    return project?.semanticTokens(uri, range) ?? emptySemanticTokens();
  }

  async function completeDocument(uri: string, position: Position): Promise<CompletionItem[]> {
    const document = getOpenDocument(uri);
    if (document === undefined) return [];
    const project = await projectForNearestConfig(uri);
    return project?.completions(uri, position, clientCapabilities) ?? [];
  }

  async function signatureHelpForDocument(
    uri: string,
    position: Position,
  ): Promise<SignatureHelp | null> {
    if (getOpenDocument(uri) === undefined) return null;
    const project = await projectForNearestConfig(uri);
    return project?.signatureHelp(uri, position, clientCapabilities.signatureLabelOffsets) ?? null;
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
        semanticTokensProvider: { legend: semanticTokensLegend, full: true, range: true },
        completionProvider: { triggerCharacters: ['.', '@', '[', '(', '{', ':', ','] },
        signatureHelpProvider: { triggerCharacters: ['(', ','] },
        ...(clientCapabilities.pullDiagnostics
          ? { diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false } }
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
      connection.console.warn(
        'Client does not support dynamic file-watcher registration; Prisma 8 config changes will not be picked up without a restart.',
      );
    }
  });

  async function handleSchemaMemberChange(uri: string): Promise<boolean> {
    const generation = ++membershipGeneration;
    documents.invalidate(uri);
    const filePath = filePathFromUri(uri);
    if (filePath === undefined) return false;
    let configPath: string | undefined;
    try {
      configPath = await findNearestConfigPathForFile(filePath);
    } catch {
      return false;
    }
    if (configPath === undefined) return false;
    return projectsByConfig.get(configPath)?.refreshMembership(uri, generation) ?? false;
  }

  connection.onDidChangeWatchedFiles(async (params) => {
    const configChanges: string[] = [];
    const memberChanges: string[] = [];
    for (const change of params.changes) {
      const filePath = filePathFromUri(change.uri);
      (filePath?.endsWith(CONFIG_FILENAME) ? configChanges : memberChanges).push(change.uri);
    }
    const changedConfigPaths = configPathsFromWatchedChanges(configChanges.map(filePathFromUri));
    const configRefreshes = Array.from(changedConfigPaths, async (configPath) => {
      return projectsByConfig
        .get(configPath)
        ?.reload()
        .catch(() => undefined);
    });
    const [, memberResults] = await Promise.all([
      Promise.all(configRefreshes),
      Promise.all(memberChanges.map(handleSchemaMemberChange)),
    ]);
    const handledMemberChange = memberResults.some(Boolean);
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
    if (!clientCapabilities.pullDiagnostics)
      return { kind: DocumentDiagnosticReportKind.Full, items: [] };
    const uri = normalizeFileUri(params.textDocument.uri);
    const project = await projectForNearestConfig(uri);
    if (project === undefined) {
      return { kind: DocumentDiagnosticReportKind.Full, items: [] };
    }
    return project.diagnosticReport(uri);
  });

  connection.onFoldingRanges(async (params): Promise<FoldingRange[]> => {
    const project = await projectForNearestConfig(params.textDocument.uri);
    return project?.foldingRanges(params.textDocument.uri) ?? [];
  });

  function projectForDocument(uri: string): Project | undefined {
    const configPath = documentConfigPaths.get(canonicalFileIdentity(uri));
    return configPath === undefined ? undefined : projectsByConfig.get(configPath);
  }

  function documentChanged(uri: string): void {
    projectForDocument(uri)?.documentChanged(uri);
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
    const project = projectForDocument(uri);
    project?.documentClosed(uri);
    documentConfigPaths.delete(canonicalFileIdentity(uri));
    if (project?.artifacts === undefined) {
      if (!clientCapabilities.pullDiagnostics)
        void connection.sendDiagnostics({ uri: normalizeFileUri(uri), diagnostics: [] });
      return;
    }
    project.publishMembers();
  });

  connection.listen();

  function artifactsForDocument(uri: string): ProjectArtifacts | undefined {
    return projectForDocument(uri)?.artifacts;
  }

  return {
    dispose: () => connection.dispose(),
    getDocumentAst: (uri) => artifactsForDocument(uri)?.document(uri),
    getProjectSymbolTable: (uri) => {
      const artifacts = artifactsForDocument(uri);
      if (artifacts?.document(uri) === undefined) return undefined;
      return artifacts.symbolTable();
    },
  };
}

function emptySemanticTokens(): SemanticTokens {
  return { data: [] };
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

function supportsCompletionCommand(
  options: unknown,
  capability: 'supportsTriggerSuggestCommand' | 'supportsTriggerParameterHintsCommand',
): boolean {
  if (typeof options !== 'object' || options === null || !('completion' in options)) return false;
  const completion = options.completion;
  if (typeof completion !== 'object' || completion === null) return false;
  return capability === 'supportsTriggerSuggestCommand'
    ? 'supportsTriggerSuggestCommand' in completion &&
        completion.supportsTriggerSuggestCommand === true
    : 'supportsTriggerParameterHintsCommand' in completion &&
        completion.supportsTriggerParameterHintsCommand === true;
}

function resolveRootPath(params: InitializeParams): string {
  const workspaceFolder = params.workspaceFolders?.[0];
  if (workspaceFolder !== undefined) return fileURLToPath(workspaceFolder.uri);
  if (params.rootUri) return fileURLToPath(params.rootUri);
  if (params.rootPath) return params.rootPath;
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
    if (path?.endsWith(CONFIG_FILENAME)) configPaths.add(path);
  }
  return configPaths;
}
