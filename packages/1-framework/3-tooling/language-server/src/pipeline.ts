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
 * `pslBlockDescriptors` is kept complete on the live path so extension-block
 * validation matches the build; the structural diagnostics (duplicate
 * declaration, invalid qualified type) hold even without descriptors.
 * `scalarTypes`, `authoringContributions`, and `controlMutationDefaults` are not
 * consumed by the pipeline itself — they are the control-stack projection
 * semantic tokens and completions classify against.
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
export function runPipeline(
  filename: string,
  text: string,
  inputs: PipelineInputs,
): PipelineResult {
  const { document, sources, diagnostics: parseDiagnostics } = parse(text, filename);
  const sourceFile = sources.sourceFileFor(document.syntax);
  const { symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: inputs.pslBlockDescriptors,
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
