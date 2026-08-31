import { buildSymbolTable, type SymbolTable } from '@internal/psl-parser';
import type { DocumentAst, SourceFile } from '@internal/psl-parser/syntax';
import { InternalError } from '@internal/utils/internal-error';
import type { ProjectInterpretation } from './config-resolution';
import { type LspDiagnostic, mapInterpreterDiagnostics } from './diagnostic-mapping';
import { computeDocumentDiagnostics, type DocumentDiagnostics } from './document-diagnostics';
import type { PipelineInputs } from './pipeline';
import type { SchemaInputSet } from './schema-inputs';

export interface DocumentArtifacts {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly diagnostics: readonly LspDiagnostic[];
  /**
   * Interpreter findings, computed on first pull at diagnostics-assembly time
   * and memoized on this artifacts instance — the store drops the instance on
   * `documentChanged` / `documentClosed`, which is the invalidation.
   */
  interpretDiagnostics(): readonly LspDiagnostic[];
}

export interface ProjectArtifactsOptions {
  readonly inputs: SchemaInputSet;
  readonly controlStack: PipelineInputs;
  readonly getText: (uri: string) => string | undefined;
  readonly interpretation?: ProjectInterpretation;
}

/**
 * Reads can never observe stale artifacts: the vscode-languageserver runtime
 * dispatches messages in order and the server raises `documentChanged` /
 * `documentClosed` synchronously against the already-updated text mirror, so
 * every mutation that could affect a read lands before that read runs. A
 * config reload replaces the store wholesale.
 */
export interface ProjectArtifacts {
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

  function createInterpretSlot(
    uri: string,
    computed: DocumentDiagnostics,
  ): () => readonly LspDiagnostic[] {
    if (interpretation === undefined) {
      return () => [];
    }
    let memo: readonly LspDiagnostic[] | undefined;
    return () => {
      if (memo === undefined) {
        const result = interpretation.source.interpret(
          {
            document: computed.document,
            sourceFile: computed.sourceFile,
            symbolTable: computed.symbolTable,
            sourceId: uri,
          },
          interpretation.context,
        );
        memo = mapInterpreterDiagnostics(
          result.ok ? [] : result.failure.diagnostics,
          computed.sourceFile,
        );
      }
      return memo;
    };
  }

  function drop(uri: string): void {
    if (documents.delete(uri)) {
      symbolTable = undefined;
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
      interpretDiagnostics: createInterpretSlot(uri, computed),
    };
    documents.set(uri, artifacts);
    // Single-input by design: the project-wide symbolTable is rebuilt from the
    // one open configured input; merging multiple inputs (and reading unopened
    // ones from disk) is deferred cross-file work.
    symbolTable = computed.symbolTable;
    return artifacts;
  }

  return {
    document: readDocument,
    symbolTable: () => {
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
        symbolTable ??= buildSymbolTable({
          document: artifacts.document,
          sourceFile: artifacts.sourceFile,
          pslBlockDescriptors: controlStack.pslBlockDescriptors,
        }).table;
        return symbolTable;
      }
      // The server's lifecycle makes this unreachable: it drops a project
      // once its last open input closes. Throwing loudly beats serving a
      // fabricated empty symbolTable that would mask the broken invariant.
      throw new InternalError(
        'invariant violated: project has no readable configured input — callers must check document artifacts first',
      );
    },
    documentChanged: drop,
    documentClosed: drop,
  };
}
