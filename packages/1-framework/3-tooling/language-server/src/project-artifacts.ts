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
  #symbolTableResult: SymbolTableResult | undefined;
  #sources: PslSources | undefined;
  #interpretMemo: ReadonlyMap<string, readonly LspDiagnostic[]> | undefined;

  constructor(options: ProjectArtifactsOptions) {
    this.#options = options;
    this.#readSnapshot = options.readSnapshot;
    this.#interpretation = options.interpretation;
    this.#inputs = options.inputs;
  }

  get sources(): PslSources {
    this.#sources ??= new PslSources(
      Array.from(
        this.#documents.values(),
        (snapshot) => [snapshot.parse().document.syntax, snapshot.sourceFile] as const,
      ),
    );
    return this.#sources;
  }

  document = (uri: string): DocumentSnapshot | undefined => this.#readDocument(uri);

  diagnostics = (
    uri: string,
    projectSymbolDiagnostics?: readonly PslDiagnostic[],
  ): readonly LspDiagnostic[] => {
    const snapshot = this.#readDocument(uri);
    if (snapshot === undefined) return [];
    const symbolDiagnostics = (projectSymbolDiagnostics ?? this.symbolDiagnostics()).filter(
      (diagnostic) => diagnostic.filename === snapshot.uri,
    );
    return [
      ...mapParseDiagnostics(snapshot.parse().diagnostics),
      ...mapParseDiagnostics(symbolDiagnostics),
      ...this.#interpretDiagnostics(snapshot.uri),
    ];
  };

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
    this.#sources = undefined;
    this.#symbolTableResult = undefined;
    this.#interpretMemo = undefined;
  }

  #projectInterpretDiagnostics(): ReadonlyMap<string, readonly LspDiagnostic[]> {
    if (this.#interpretation === undefined) {
      return new Map();
    }
    this.#interpretMemo ??= this.#computeInterpretDistribution(this.#interpretation);
    return this.#interpretMemo;
  }

  #computeInterpretDistribution(
    activeInterpretation: ProjectInterpretation,
  ): ReadonlyMap<string, readonly LspDiagnostic[]> {
    const currentSymbolTable = (this.#symbolTableResult ?? this.#readSymbolTableResult())
      .symbolTable;
    const allDocuments = Array.from(
      this.#documents.values(),
      (snapshot) => snapshot.parse().document,
    );
    const warnings: ContractSourceDiagnostic[] = [];
    const result = activeInterpretation.source.interpret(
      { documents: allDocuments, sources: this.sources, symbolTable: currentSymbolTable },
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

  #interpretDiagnostics(uri: string): readonly LspDiagnostic[] {
    try {
      return this.#projectInterpretDiagnostics().get(uri) ?? [];
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
  }

  #drop(uri: string): void {
    if (this.#documents.delete(canonicalFileIdentity(uri))) {
      this.#refreshSources();
    }
  }

  #readDocument(uri: string): DocumentSnapshot | undefined {
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
    return snapshot;
  }

  #readSymbolTableResult(): SymbolTableResult {
    const currentDocuments: DocumentAst[] = [];
    for (const uri of this.#inputs.uris()) {
      const snapshot = this.#readDocument(uri);
      if (snapshot !== undefined) currentDocuments.push(snapshot.parse().document);
    }
    this.#symbolTableResult ??= buildSymbolTable({
      documents: currentDocuments,
      sources: this.sources,
    });
    return this.#symbolTableResult;
  }

  #readSymbolTable(): SymbolTable {
    return this.#readSymbolTableResult().symbolTable;
  }
}
