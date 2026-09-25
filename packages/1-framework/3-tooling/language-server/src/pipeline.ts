import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import type {
  AssembledAuthoringContributions,
  ControlMutationDefaults,
} from '@internal/framework-components/control';
import { buildSymbolTable, type SymbolTable } from '@internal/psl-parser';
import {
  type DocumentAst,
  type PslSources,
  parse,
  type SourceFile,
} from '@internal/psl-parser/syntax';
import { type LspDiagnostic, mapParseDiagnostics } from './diagnostic-mapping';

/**
 * The pipeline itself consumes none of these fields — they are the
 * control-stack projection that semantic tokens and completions classify
 * against. Block-value diagnostics ride the interpreter-diagnostics lane,
 * not this pipeline.
 */
export interface PipelineInputs {
  readonly scalarTypes: readonly string[];
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  readonly authoringContributions?: AssembledAuthoringContributions;
  readonly controlMutationDefaults?: ControlMutationDefaults;
}

export interface PipelineResult {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly sources: PslSources;
  readonly symbolTable: SymbolTable;
  readonly diagnostics: readonly LspDiagnostic[];
  readonly parseDiagnostics: readonly LspDiagnostic[];
}

/**
 * Composes the stages exactly as the contract-psl provider does, so the editor
 * and the build agree: `parse` then `buildSymbolTable`, parse diagnostics ahead
 * of symbol-table diagnostics. Never throws on malformed input — `parse`
 * recovers and `buildSymbolTable` is documented not to throw.
 */
export function runPipeline(filename: string, text: string): PipelineResult {
  const { document, sources, diagnostics: parseDiagnostics } = parse(text, filename);
  const sourceFile = sources.sourceFileFor(document.syntax);
  const { symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({
    documents: [document],
    sources,
  });

  return {
    document,
    sourceFile,
    sources,
    symbolTable,
    parseDiagnostics: mapParseDiagnostics(parseDiagnostics),
    diagnostics: mapParseDiagnostics([...parseDiagnostics, ...symbolTableDiagnostics]),
  };
}
