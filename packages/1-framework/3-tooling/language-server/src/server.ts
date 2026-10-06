import { fileURLToPath } from 'node:url';
import { isPrismaNextSchema, type SymbolTable } from '@internal/psl-parser';
import {
  type CompletionItem,
  type Connection,
  type DocumentDiagnosticReport,
  DocumentDiagnosticReportKind,
  type FoldingRange,
  type Hover,
  type InitializeParams,
  type InitializeResult,
  type Location,
  type LocationLink,
  type Position,
  type Range,
  type SemanticTokens,
  type SignatureHelp,
  TextDocumentSyncKind,
  type TextEdit,
} from 'vscode-languageserver';
import type { DocumentSnapshot } from './document-snapshot';
import { DocumentStore } from './document-store';
import { guardedConnection } from './guarded-connection';
import type { ProjectArtifacts } from './project-artifacts';
import { ProjectRegistry } from './project-registry';
import { normalizeFileUri } from './schema-inputs';
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
  const projects = new ProjectRegistry(documents, connection);
  let rootPath = process.cwd();
  let clientCapabilities = noClientCapabilities;

  async function formatDocument(uri: string): Promise<TextEdit[]> {
    const document = getOpenDocument(uri);
    if (document === undefined) return [];
    const source = document.getText();
    if (!isPrismaNextSchema(source)) return [];
    const project = await projects.nearestProject(uri);
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
    const project = await projects.nearestProject(uri);
    return project?.semanticTokens(uri, range) ?? emptySemanticTokens();
  }

  async function completeDocument(uri: string, position: Position): Promise<CompletionItem[]> {
    const document = getOpenDocument(uri);
    if (document === undefined) return [];
    const project = await projects.nearestProject(uri);
    return project?.completions(uri, position, clientCapabilities) ?? [];
  }

  async function signatureHelpForDocument(
    uri: string,
    position: Position,
  ): Promise<SignatureHelp | null> {
    if (getOpenDocument(uri) === undefined) return null;
    const project = await projects.nearestProject(uri);
    return project?.signatureHelp(uri, position, clientCapabilities.signatureLabelOffsets) ?? null;
  }

  async function hoverForDocument(uri: string, position: Position): Promise<Hover | null> {
    if (getOpenDocument(uri) === undefined) return null;
    const project = await projects.nearestProject(uri);
    return project?.hover(uri, position) ?? null;
  }

  async function definitionForDocument(
    uri: string,
    position: Position,
  ): Promise<LocationLink[] | Location[] | null> {
    if (getOpenDocument(uri) === undefined) return null;
    const project = await projects.nearestProject(uri);
    return project?.definition(uri, position, clientCapabilities.definitionLinks) ?? null;
  }

  connection.onInitialize(async (params): Promise<InitializeResult> => {
    rootPath = resolveRootPath(params);
    clientCapabilities = resolveClientCapabilities(params);
    projects.setClientCapabilities(clientCapabilities);
    return {
      capabilities: {
        textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Incremental },
        documentFormattingProvider: true,
        foldingRangeProvider: true,
        semanticTokensProvider: { legend: semanticTokensLegend, full: true, range: true },
        completionProvider: { triggerCharacters: ['.', '@', '[', '(', '{', ':', ','] },
        signatureHelpProvider: { triggerCharacters: ['(', ','] },
        hoverProvider: true,
        definitionProvider: true,
        ...(clientCapabilities.pullDiagnostics
          ? { diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false } }
          : {}),
      },
    };
  });

  connection.onInitialized(() => projects.watchConfigFiles(rootPath));
  connection.onDidChangeWatchedFiles((params) => projects.watchedFilesChanged(params.changes));

  connection.onDocumentFormatting((params) => formatDocument(params.textDocument.uri));
  connection.onCompletion((params) => completeDocument(params.textDocument.uri, params.position));
  connection.onSignatureHelp((params) =>
    signatureHelpForDocument(params.textDocument.uri, params.position),
  );
  connection.onDefinition((params) =>
    definitionForDocument(params.textDocument.uri, params.position),
  );
  connection.onHover((params) => hoverForDocument(params.textDocument.uri, params.position));
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
    const project = await projects.nearestProject(uri);
    if (project === undefined) {
      return { kind: DocumentDiagnosticReportKind.Full, items: [] };
    }
    return project.diagnosticReport(uri);
  });

  connection.onFoldingRanges(async (params): Promise<FoldingRange[]> => {
    const project = await projects.nearestProject(params.textDocument.uri);
    return project?.foldingRanges(params.textDocument.uri) ?? [];
  });

  connection.onDidOpenTextDocument((event) => {
    const document = documents.open(event.textDocument);
    projects.documentChanged(document.uri);
  });
  connection.onDidChangeTextDocument((event) => {
    const document = documents.change(event.textDocument, event.contentChanges);
    if (document !== undefined) projects.documentChanged(document.uri);
  });
  connection.onDidCloseTextDocument((event) => {
    const document = documents.close(event.textDocument.uri);
    if (document === undefined) return;
    projects.documentClosed(document.uri);
  });

  connection.listen();

  function artifactsForDocument(uri: string): ProjectArtifacts | undefined {
    return projects.associatedProject(uri)?.artifacts;
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
  readonly definitionLinks: boolean;
  readonly completionTriggerSuggestCommand: boolean;
  readonly completionTriggerParameterHintsCommand: boolean;
  readonly pullDiagnostics: boolean;
  readonly diagnosticsRefresh: boolean;
}

const noClientCapabilities: ResolvedClientCapabilities = {
  watchedFilesRegistration: false,
  completionSnippets: false,
  signatureLabelOffsets: false,
  definitionLinks: false,
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
    definitionLinks: params.capabilities.textDocument?.definition?.linkSupport === true,
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
