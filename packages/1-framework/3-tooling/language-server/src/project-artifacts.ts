import { buildSymbolTable, type SymbolTable } from '@internal/psl-parser';
import { type DocumentAst, PslSources, type SourceFile } from '@internal/psl-parser/syntax';
import { InternalError } from '@internal/utils/internal-error';
import { LSPErrorCodes, ResponseError } from 'vscode-languageserver';
import type { ProjectInterpretation } from './config-resolution';
import {
  type LspDiagnostic,
  mapInterpreterDiagnostics,
  ParseDiagnosticSeverity,
} from './diagnostic-mapping';
import { computeDocumentDiagnostics } from './document-diagnostics';
import type { PipelineInputs } from './pipeline';
import type { SchemaInputSet } from './schema-inputs';

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
  let symbolTable: SymbolTable | undefined;
  let sources = new PslSources([]);

  function refreshSources(): void {
    sources = new PslSources(
      Array.from(
        documents.values(),
        ({ document, sourceFile }) => [document.syntax, sourceFile] as const,
      ),
    );
    symbolTable = undefined;
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
      if (memo === undefined || memoSources !== sources) {
        const currentSymbolTable = readSymbolTable();
        const result = interpretation.source.interpret(
          {
            document,
            sources,
            symbolTable: currentSymbolTable,
          },
          interpretation.context,
        );
        memo = mapInterpreterDiagnostics(result.ok ? [] : result.failure.diagnostics, sourceFile);
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
    if (documents.delete(uri)) {
      refreshSources();
    }
  }

  function readDocument(uri: string): DocumentArtifacts | undefined {
    const existing = documents.get(uri);
    if (existing !== undefined) {
      return existing;
    }
    const text = getText(uri);
    if (text === undefined) {
      return undefined;
    }
    const computed = computeDocumentDiagnostics(uri, text, inputs, controlStack);
    if (computed === null) {
      return undefined;
    }
    const artifacts: DocumentArtifacts = {
      document: computed.document,
      sourceFile: computed.sourceFile,
      diagnostics: computed.diagnostics,
      interpretDiagnostics: createInterpretSlot(uri, computed.document, computed.sourceFile),
    };
    documents.set(uri, artifacts);
    refreshSources();
    // Single-input by design: the project-wide symbolTable is rebuilt from the
    // one open configured input; merging multiple inputs (and reading unopened
    // ones from disk) is deferred cross-file work.
    symbolTable = computed.symbolTable;
    return artifacts;
  }

  function readSymbolTable(): SymbolTable {
    if (symbolTable !== undefined) {
      return symbolTable;
    }
    for (const uri of inputs.uris()) {
      const artifacts = readDocument(uri);
      if (artifacts === undefined) {
        continue;
      }
      // A read that hits existing artifacts leaves the slot unset (the
      // contributing input may have closed since); rebuild from the
      // artifacts without reparsing.
      if (symbolTable === undefined) {
        const symbolTableInput = {
          document: artifacts.document,
          sources,
          pslBlockDescriptors: controlStack.pslBlockDescriptors,
        };
        symbolTable = buildSymbolTable(symbolTableInput).symbolTable;
      }
      return symbolTable;
    }
    // The server's lifecycle makes this unreachable: it drops a project
    // once its last open input closes. Throwing loudly beats serving a
    // fabricated empty symbolTable that would mask the broken invariant.
    throw new InternalError(
      'invariant violated: project has no readable configured input — callers must check document artifacts first',
    );
  }

  return {
    get sources() {
      return sources;
    },
    document: readDocument,
    symbolTable: readSymbolTable,
    documentChanged: drop,
    documentClosed: drop,
  };
}
