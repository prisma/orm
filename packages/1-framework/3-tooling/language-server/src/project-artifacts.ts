import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import {
  buildSymbolTable,
  isPrismaNextSchema,
  type PslDiagnostic,
  type SymbolTable,
  type SymbolTableResult,
} from '@internal/psl-parser';
import { type DocumentAst, PslSources, type SourceFile } from '@internal/psl-parser/syntax';
import { LSPErrorCodes, ResponseError } from 'vscode-languageserver';
import type { ProjectInterpretation } from './config-resolution';
import {
  type LspDiagnostic,
  mapInterpreterDiagnostic,
  mapParseDiagnostics,
  ParseDiagnosticSeverity,
} from './diagnostic-mapping';
import type { DocumentSnapshot } from './document-snapshot';
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
  readonly readSnapshot: (uri: string) => DocumentSnapshot | undefined;
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

export function createProjectArtifacts(options: ProjectArtifactsOptions): ProjectArtifacts {
  const { readSnapshot, interpretation } = options;
  let inputs = options.inputs;
  const documents = new Map<string, DocumentSnapshot>();
  const documentFacades = new WeakMap<DocumentSnapshot, DocumentArtifacts>();
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
        (snapshot) => [snapshot.parse().document.syntax, snapshot.sourceFile] as const,
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
    const allDocuments = Array.from(documents.values(), (snapshot) => snapshot.parse().document);
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
    const diagnostics = [...warnings, ...(result.ok ? [] : result.failure.diagnostics)];
    if (diagnostics.length === 0) {
      return new Map();
    }
    const sourceFileByFilename = new Map<string, SourceFile>();
    for (const snapshot of documents.values()) {
      sourceFileByFilename.set(snapshot.uri, snapshot.sourceFile);
    }
    const bySourceId = new Map<string, LspDiagnostic[]>();
    for (const diagnostic of diagnostics) {
      const sourceFile = sourceFileByFilename.get(diagnostic.sourceId);
      if (sourceFile === undefined) continue;
      const mapped = mapInterpreterDiagnostic(diagnostic, sourceFile);
      const group = bySourceId.get(diagnostic.sourceId);
      if (group === undefined) {
        bySourceId.set(diagnostic.sourceId, [mapped]);
      } else {
        group.push(mapped);
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
    const snapshot = readSnapshot(uri);
    if (snapshot === undefined || !inputs.includes(uri) || !isPrismaNextSchema(snapshot.text)) {
      if (documents.delete(identity)) {
        refreshSources();
      }
      return undefined;
    }
    if (documents.get(identity) !== snapshot) {
      documents.set(identity, snapshot);
      refreshSources();
    }
    let facade = documentFacades.get(snapshot);
    if (facade === undefined) {
      facade = {
        get document() {
          return snapshot.parse().document;
        },
        get sourceFile() {
          return snapshot.sourceFile;
        },
        diagnostics: mapParseDiagnostics(snapshot.parse().diagnostics),
        interpretDiagnostics: createInterpretSlot(snapshot.uri, snapshot.sourceFile),
      };
      documentFacades.set(snapshot, facade);
    }
    return facade;
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
