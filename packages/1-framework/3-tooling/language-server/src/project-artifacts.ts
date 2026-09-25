import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import {
  buildSymbolTable,
  type PslDiagnostic,
  type SymbolTable,
  type SymbolTableResult,
} from '@internal/psl-parser';
import { type DocumentAst, PslSources, type SourceFile } from '@internal/psl-parser/syntax';
import { LSPErrorCodes, ResponseError } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ProjectInterpretation } from './config-resolution';
import {
  type LspDiagnostic,
  mapInterpreterDiagnostics,
  ParseDiagnosticSeverity,
} from './diagnostic-mapping';
import { computeDocumentDiagnostics } from './document-diagnostics';
import { canonicalFileIdentity, type SchemaInputSet } from './schema-inputs';

export interface DocumentArtifacts {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly diagnostics: readonly LspDiagnostic[];
  /**
   * Interpreter findings, computed on first pull at diagnostics-assembly time
   * and memoized for the current project source registry.
   */
  interpretDiagnostics(): readonly LspDiagnostic[];
}

export interface ProjectArtifactsOptions {
  readonly inputs: SchemaInputSet;
  /**
   * The open overlay, if any — consulted only for its own URI spelling
   * (a client's live document URI can differ in encoding/casing from the
   * configured input string that names the same file).
   */
  readonly getDocument: (uri: string) => TextDocument | undefined;
  /** Overlay text if the member is open, disk text otherwise; `undefined` on a miss. */
  readonly readText: (uri: string) => string | undefined;
  readonly interpretation?: ProjectInterpretation;
  readonly onInterpretationError: (uri: string, error: unknown) => void;
}

/**
 * Reads can never observe stale artifacts: the vscode-languageserver runtime
 * dispatches messages in order and the server raises `documentChanged` /
 * `documentClosed` synchronously against the already-updated text mirror, so
 * every mutation that could affect a read lands before that read runs. A
 * config reload replaces the store wholesale.
 */
export interface ProjectArtifacts {
  readonly sources: PslSources;
  /**
   * `undefined` when the member has no readable text (open or on disk) or is
   * not one of the project's configured inputs.
   */
  document(uri: string): DocumentArtifacts | undefined;
  symbolTable(): SymbolTable;
  symbolDiagnostics(): readonly PslDiagnostic[];
  documentChanged(uri: string): void;
  documentClosed(uri: string): void;
}

export function createProjectArtifacts(options: ProjectArtifactsOptions): ProjectArtifacts {
  const { inputs, getDocument, readText, interpretation } = options;
  const documents = new Map<string, DocumentArtifacts>();
  let symbolTableResult: SymbolTableResult | undefined;
  let sources = new PslSources([]);

  function refreshSources(): void {
    sources = new PslSources(
      Array.from(
        documents.values(),
        ({ document, sourceFile }) => [document.syntax, sourceFile] as const,
      ),
    );
    symbolTableResult = undefined;
  }

  function createInterpretSlot(
    uri: string,
    document: DocumentAst,
    sourceFile: SourceFile,
  ): () => readonly LspDiagnostic[] {
    if (interpretation === undefined) {
      return () => [];
    }
    let memo: readonly LspDiagnostic[] | undefined;
    let memoSources: PslSources | undefined;
    const interpretDiagnostics = (): readonly LspDiagnostic[] => {
      const currentSymbolTable = readSymbolTable();
      if (memo === undefined || memoSources !== sources) {
        const warnings: ContractSourceDiagnostic[] = [];
        const result = interpretation.source.interpret(
          {
            documents: [document],
            sources,
            symbolTable: currentSymbolTable,
          },
          {
            ...interpretation.context,
            reportWarning: (diagnostic) => {
              warnings.push({ ...diagnostic, severity: 'warning' });
            },
          },
        );
        const diagnostics = [...warnings, ...(result.ok ? [] : result.failure.diagnostics)].filter(
          (diagnostic) => diagnostic.sourceId === sourceFile.filename,
        );
        memo = mapInterpreterDiagnostics(diagnostics, sourceFile);
        memoSources = sources;
      }
      return memo;
    };
    return () => {
      try {
        return interpretDiagnostics();
      } catch (error) {
        if (
          error instanceof ResponseError &&
          (error.code === LSPErrorCodes.RequestCancelled ||
            error.code === LSPErrorCodes.ServerCancelled ||
            error.code === LSPErrorCodes.ContentModified)
        ) {
          throw error;
        }
        options.onInterpretationError(uri, error);
        return [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            code: 'PRISMA_NEXT_INTERPRETATION_FAILED',
            message:
              'Semantic diagnostics are unavailable because of an internal error. A subsequent diagnostic request or edit will retry.',
            severity: ParseDiagnosticSeverity.Error,
          },
        ];
      }
    };
  }

  function drop(uri: string): void {
    if (documents.delete(canonicalFileIdentity(uri))) {
      refreshSources();
    }
  }

  function readDocument(uri: string): DocumentArtifacts | undefined {
    const identity = canonicalFileIdentity(uri);
    const existing = documents.get(identity);
    if (existing !== undefined) {
      return existing;
    }
    // An open overlay keeps its own URI spelling (a client's live document
    // URI can differ in encoding/casing from the configured input string);
    // a disk-only member has no such live spelling, so it uses `uri` as
    // given by the membership set.
    const resolvedUri = getDocument(uri)?.uri ?? uri;
    const text = readText(uri);
    if (text === undefined) {
      return undefined;
    }
    const computed = computeDocumentDiagnostics(resolvedUri, text, inputs);
    if (computed === null) {
      return undefined;
    }
    const artifacts: DocumentArtifacts = {
      document: computed.document,
      sourceFile: computed.sourceFile,
      diagnostics: computed.parseDiagnostics,
      interpretDiagnostics: createInterpretSlot(
        resolvedUri,
        computed.document,
        computed.sourceFile,
      ),
    };
    documents.set(identity, artifacts);
    refreshSources();
    return artifacts;
  }

  function readSymbolTableResult(): SymbolTableResult {
    const currentDocuments: DocumentAst[] = [];
    for (const uri of inputs.uris()) {
      const artifacts = readDocument(uri);
      if (artifacts !== undefined) currentDocuments.push(artifacts.document);
    }
    symbolTableResult ??= buildSymbolTable({ documents: currentDocuments, sources });
    return symbolTableResult;
  }

  function readSymbolTable(): SymbolTable {
    return readSymbolTableResult().symbolTable;
  }

  return {
    get sources() {
      return sources;
    },
    document: readDocument,
    symbolTable: readSymbolTable,
    symbolDiagnostics: () => readSymbolTableResult().diagnostics,
    documentChanged: drop,
    documentClosed: drop,
  };
}
