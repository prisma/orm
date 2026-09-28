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

function schemaInputIdentities(inputs: SchemaInputSet): ReadonlySet<string> {
  return new Set(Array.from(inputs.uris(), canonicalFileIdentity));
}

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
  readonly getDocument: (uri: string) => TextDocument | undefined;
  readonly readText: (uri: string) => string | undefined;
  readonly interpretation?: ProjectInterpretation;
  readonly onInterpretationError: (uri: string, error: unknown) => void;
}

export interface ProjectArtifacts {
  readonly sources: PslSources;
  document(uri: string): DocumentArtifacts | undefined;
  symbolTable(): SymbolTable;
  symbolDiagnostics(): readonly PslDiagnostic[];
  documentChanged(uri: string): void;
  documentClosed(uri: string): void;
  updateInputs(next: SchemaInputSet): void;
}

interface CachedDocument {
  readonly text: string;
  readonly artifacts: DocumentArtifacts;
}

export function createProjectArtifacts(options: ProjectArtifactsOptions): ProjectArtifacts {
  const {, getDocument, readText, interpretation } = options;
  let inputs = options.inputs;
  const documents = new Map<string, CachedDocument>();
  let symbolTableResult: SymbolTableResult | undefined;
  let sources = new PslSources([]);
  let interpretMemo:
    | {
        readonly sources: PslSources;
        readonly bySourceId: ReadonlyMap<string, readonly LspDiagnostic[]>;
      }
    | undefined;

  function refreshSources(): void {
    sources = new PslSources(
      Array.from(
        documents.values(),
        ({ artifacts }) => [artifacts.document.syntax, artifacts.sourceFile] as const,
      ),
    );
    symbolTableResult = undefined;
    interpretMemo = undefined;
  }

  function projectInterpretDiagnostics(): ReadonlyMap<string, readonly LspDiagnostic[]> {
    if (interpretation === undefined) {
      return new Map();
    }
    if (interpretMemo === undefined || interpretMemo.sources !== sources) {
      interpretMemo = { sources, bySourceId: computeInterpretDistribution(interpretation) };
    }
    return interpretMemo.bySourceId;
  }

  function computeInterpretDistribution(
    activeInterpretation: ProjectInterpretation,
  ): ReadonlyMap<string, readonly LspDiagnostic[]> {
    const currentSymbolTable = readSymbolTable();
    const allDocuments = Array.from(documents.values(), ({ artifacts }) => artifacts.document);
    const warnings: ContractSourceDiagnostic[] = [];
    const result = activeInterpretation.source.interpret(
      { documents: allDocuments, sources, symbolTable: currentSymbolTable },
      {
        ...activeInterpretation.context,
        reportWarning: (diagnostic) => {
          warnings.push({ ...diagnostic, severity: 'warning' });
        },
      },
    );
    const sourceFileByFilename = new Map<string, SourceFile>();
    for (const { artifacts } of documents.values()) {
      sourceFileByFilename.set(artifacts.sourceFile.filename, artifacts.sourceFile);
    }
    const grouped = new Map<string, ContractSourceDiagnostic[]>();
    for (const diagnostic of [...warnings, ...(result.ok ? [] : result.failure.diagnostics)]) {
      const group = grouped.get(diagnostic.sourceId);
      if (group === undefined) {
        grouped.set(diagnostic.sourceId, [diagnostic]);
      } else {
        group.push(diagnostic);
      }
    }
    const bySourceId = new Map<string, readonly LspDiagnostic[]>();
    for (const [sourceId, diagnostics] of grouped) {
      const sourceFile = sourceFileByFilename.get(sourceId);
      if (sourceFile !== undefined) {
        bySourceId.set(sourceId, mapInterpreterDiagnostics(diagnostics, sourceFile));
      }
    }
    return bySourceId;
  }

  function createInterpretSlot(
    uri: string,
    sourceFile: SourceFile,
  ): () => readonly LspDiagnostic[] {
    if (interpretation === undefined) {
      return () => [];
    }
    return () => {
      try {
        return projectInterpretDiagnostics().get(sourceFile.filename) ?? [];
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

  function updateInputs(next: SchemaInputSet): void {
    inputs = next;
    const validIdentities = schemaInputIdentities(next);
    let changed = false;
    for (const identity of documents.keys()) {
      if (!validIdentities.has(identity)) {
        documents.delete(identity);
        changed = true;
      }
    }
    if (changed) {
      refreshSources();
    }
  }

  function readDocument(uri: string): DocumentArtifacts | undefined {
    const identity = canonicalFileIdentity(uri);
    const text = readText(uri);
    if (text === undefined) {
      if (documents.delete(identity)) {
        refreshSources();
      }
      return undefined;
    }
    const existing = documents.get(identity);
    if (existing !== undefined && existing.text === text) {
      return existing.artifacts;
    }
    const resolvedUri = getDocument(uri)?.uri ?? uri;
    const computed = computeDocumentDiagnostics(resolvedUri, text, inputs);
    if (computed === null) {
      if (documents.delete(identity)) {
        refreshSources();
      }
      return undefined;
    }
    const artifacts: DocumentArtifacts = {
      document: computed.document,
      sourceFile: computed.sourceFile,
      diagnostics: computed.parseDiagnostics,
      interpretDiagnostics: createInterpretSlot(resolvedUri, computed.sourceFile),
    };
    documents.set(identity, { text, artifacts });
    refreshSources();
    return artifacts;
  }

  function readSymbolTableResult(): SymbolTableResult {
    const currentDocuments: DocumentAst[] = [];
    for (const uri of inputs.uris()) {
      const artifacts = readDocument(uri);
      if (artifacts !== undefined) currentDocuments.push(artifacts.document);
    }
    symbolTableResult ??= buildSymbolTable({
      documents: currentDocuments,
      sources,
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
    symbolDiagnostics: () => readSymbolTableResult().diagnostics,
    documentChanged: drop,
    documentClosed: drop,
    updateInputs,
  };
}
