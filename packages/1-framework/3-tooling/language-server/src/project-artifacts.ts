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

export class ProjectArtifacts {
  readonly #options: ProjectArtifactsOptions;
  readonly #readSnapshot: ProjectArtifactsOptions['readSnapshot'];
  readonly #interpretation: ProjectInterpretation | undefined;
  #inputs: SchemaInputSet;
  readonly #documents = new Map<string, DocumentSnapshot>();
  readonly #artifactsBySnapshot = new WeakMap<DocumentSnapshot, DocumentArtifacts>();
  #symbolTableResult: SymbolTableResult | undefined;
  #sources = new PslSources([]);
  #interpretMemo:
    | {
        readonly sources: PslSources;
        readonly bySourceId: ReadonlyMap<string, readonly LspDiagnostic[]>;
      }
    | undefined;

  constructor(options: ProjectArtifactsOptions) {
    this.#options = options;
    this.#readSnapshot = options.readSnapshot;
    this.#interpretation = options.interpretation;
    this.#inputs = options.inputs;
  }

  get sources(): PslSources {
    return this.#sources;
  }

  document = (uri: string): DocumentArtifacts | undefined => this.#readDocument(uri);

  symbolTable = (): SymbolTable => this.#readSymbolTable();

  symbolDiagnostics = (): readonly PslDiagnostic[] => this.#readSymbolTableResult().diagnostics;

  documentChanged = (uri: string): void => this.#drop(uri);

  documentClosed = this.documentChanged;

  updateInputs = (next: SchemaInputSet): void => {
    this.#inputs = next;
    const validIdentities = schemaInputIdentities(next);
    let changed = false;
    for (const identity of this.#documents.keys()) {
      if (!validIdentities.has(identity)) {
        this.#documents.delete(identity);
        changed = true;
      }
    }
    if (changed) {
      this.#refreshSources();
    }
  };

  #refreshSources(): void {
    this.#sources = new PslSources(
      Array.from(
        this.#documents.values(),
        (snapshot) => [snapshot.parse().document.syntax, snapshot.sourceFile] as const,
      ),
    );
    this.#symbolTableResult = undefined;
    this.#interpretMemo = undefined;
  }

  #projectInterpretDiagnostics(): ReadonlyMap<string, readonly LspDiagnostic[]> {
    if (this.#interpretation === undefined) {
      return new Map();
    }
    if (this.#interpretMemo === undefined || this.#interpretMemo.sources !== this.#sources) {
      this.#interpretMemo = {
        sources: this.#sources,
        bySourceId: this.#computeInterpretDistribution(this.#interpretation),
      };
    }
    return this.#interpretMemo.bySourceId;
  }

  #computeInterpretDistribution(
    activeInterpretation: ProjectInterpretation,
  ): ReadonlyMap<string, readonly LspDiagnostic[]> {
    const currentSymbolTable = this.#readSymbolTable();
    const allDocuments = Array.from(
      this.#documents.values(),
      (snapshot) => snapshot.parse().document,
    );
    const warnings: ContractSourceDiagnostic[] = [];
    const result = activeInterpretation.source.interpret(
      { documents: allDocuments, sources: this.#sources, symbolTable: currentSymbolTable },
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
    for (const snapshot of this.#documents.values()) {
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

  #createInterpretSlot(uri: string, sourceFile: SourceFile): () => readonly LspDiagnostic[] {
    if (this.#interpretation === undefined) {
      return () => [];
    }
    return () => {
      try {
        return this.#projectInterpretDiagnostics().get(sourceFile.filename) ?? [];
      } catch (error) {
        if (
          error instanceof ResponseError &&
          (error.code === LSPErrorCodes.RequestCancelled ||
            error.code === LSPErrorCodes.ServerCancelled ||
            error.code === LSPErrorCodes.ContentModified)
        ) {
          throw error;
        }
        this.#options.onInterpretationError(uri, error);
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

  #drop(uri: string): void {
    if (this.#documents.delete(canonicalFileIdentity(uri))) {
      this.#refreshSources();
    }
  }

  #readDocument(uri: string): DocumentArtifacts | undefined {
    const identity = canonicalFileIdentity(uri);
    const readSnapshot = this.#readSnapshot;
    const snapshot = readSnapshot(uri);
    if (
      snapshot === undefined ||
      !this.#inputs.includes(uri) ||
      !isPrismaNextSchema(snapshot.text)
    ) {
      if (this.#documents.delete(identity)) {
        this.#refreshSources();
      }
      return undefined;
    }
    if (this.#documents.get(identity) !== snapshot) {
      this.#documents.set(identity, snapshot);
      this.#refreshSources();
    }
    let facade = this.#artifactsBySnapshot.get(snapshot);
    if (facade === undefined) {
      facade = {
        get document() {
          return snapshot.parse().document;
        },
        get sourceFile() {
          return snapshot.sourceFile;
        },
        diagnostics: mapParseDiagnostics(snapshot.parse().diagnostics),
        interpretDiagnostics: this.#createInterpretSlot(snapshot.uri, snapshot.sourceFile),
      };
      this.#artifactsBySnapshot.set(snapshot, facade);
    }
    return facade;
  }

  #readSymbolTableResult(): SymbolTableResult {
    const currentDocuments: DocumentAst[] = [];
    for (const uri of this.#inputs.uris()) {
      const artifacts = this.#readDocument(uri);
      if (artifacts !== undefined) currentDocuments.push(artifacts.document);
    }
    this.#symbolTableResult ??= buildSymbolTable({
      documents: currentDocuments,
      sources: this.#sources,
    });
    return this.#symbolTableResult;
  }

  #readSymbolTable(): SymbolTable {
    return this.#readSymbolTableResult().symbolTable;
  }
}
