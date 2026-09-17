import { buildSymbolTable, type SymbolTable, type SymbolTableResult } from '@internal/psl-parser';
import { type DocumentAst, PslSources, type SourceFile } from '@internal/psl-parser/syntax';
import { InternalError } from '@internal/utils/internal-error';
import { LSPErrorCodes, ResponseError } from 'vscode-languageserver';
import type { ProjectInterpretation } from './config-resolution';
import {
  type LspDiagnostic,
  mapInterpreterDiagnostics,
  mapParseDiagnostics,
  ParseDiagnosticSeverity,
} from './diagnostic-mapping';
import { computeDocumentDiagnostics } from './document-diagnostics';
import type { PipelineInputs } from './pipeline';
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
  readonly controlStack: PipelineInputs;
  readonly getText: (uri: string) => string | undefined;
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
   * `undefined` when the document is not open in the text mirror or is not
   * one of the project's configured inputs.
   */
  document(uri: string): DocumentArtifacts | undefined;
  symbolTable(): SymbolTable;
  documentChanged(uri: string): void;
  documentClosed(uri: string): void;
}

export function createProjectArtifacts(options: ProjectArtifactsOptions): ProjectArtifacts {
  const { inputs, controlStack, getText, interpretation } = options;
  const documents = new Map<string, DocumentArtifacts>();
  const liveUris = new Map<string, string>();
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
        const result = interpretation.source.interpret(
          {
            document,
            sources,
            symbolTable: currentSymbolTable,
          },
          interpretation.context,
        );
        const diagnostics = result.ok
          ? []
          : result.failure.diagnostics.filter(
              (diagnostic) =>
                diagnostic.sourceId === undefined || diagnostic.sourceId === sourceFile.filename,
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
    const liveUri = liveUris.get(identity) ?? uri;
    const text = getText(liveUri);
    if (text === undefined) {
      return undefined;
    }
    const computed = computeDocumentDiagnostics(liveUri, text, inputs, controlStack);
    if (computed === null) {
      return undefined;
    }
    const artifacts: DocumentArtifacts = {
      document: computed.document,
      sourceFile: computed.sourceFile,
      get diagnostics() {
        const result = readSymbolTableResult();
        return [
          ...computed.parseDiagnostics,
          ...mapParseDiagnostics(
            result.diagnostics.filter(
              (diagnostic) => diagnostic.sourceFile === computed.sourceFile,
            ),
          ),
        ];
      },
      interpretDiagnostics: createInterpretSlot(liveUri, computed.document, computed.sourceFile),
    };
    liveUris.set(identity, liveUri);
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
    if (currentDocuments.length === 0) {
      throw new InternalError(
        'invariant violated: project has no readable configured input — callers must check document artifacts first',
      );
    }
    symbolTableResult ??= buildSymbolTable({
      documents: currentDocuments,
      sources,
      pslBlockDescriptors: controlStack.pslBlockDescriptors,
    });
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
    documentChanged: drop,
    documentClosed(uri) {
      drop(uri);
      liveUris.delete(canonicalFileIdentity(uri));
    },
  };
}
