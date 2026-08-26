import type { SymbolTable } from '@internal/psl-parser';
import type { DocumentAst, SourceFile } from '@internal/psl-parser/syntax';
import type { LspDiagnostic } from './diagnostic-mapping';
import { type PipelineInputs, runPipeline } from './pipeline';
import { isPrismaNextSchema } from './prisma-next-directive';
import type { SchemaInputSet } from './schema-inputs';

export interface DocumentDiagnostics {
  readonly diagnostics: readonly LspDiagnostic[];
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly symbolTable: SymbolTable;
}

/**
 * `null` (not a configured input) is distinct from a `DocumentDiagnostics` whose
 * `diagnostics` are `[]` (an input that parsed clean): the caller treats both as
 * "publish no diagnostics", but only the latter is a document we own and keep
 * diagnosing.
 */
export function computeDocumentDiagnostics(
  uri: string,
  text: string,
  inputs: SchemaInputSet,
  controlStack: PipelineInputs,
): DocumentDiagnostics | null {
  if (!inputs.includes(uri) || !isPrismaNextSchema(text)) {
    return null;
  }
  const { document, sourceFile, symbolTable, diagnostics } = runPipeline(text, controlStack);
  return { diagnostics, document, sourceFile, symbolTable };
}
