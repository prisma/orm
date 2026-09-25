import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import type {
  AssembledAuthoringContributions,
  ControlMutationDefaults,
} from '@internal/framework-components/control';
import {
  type DocumentAst,
  type PslSources,
  parse,
  type SourceFile,
} from '@internal/psl-parser/syntax';
import { type LspDiagnostic, mapParseDiagnostics } from './diagnostic-mapping';

/**
 * `pslBlockDescriptors` feeds the project-wide symbol table
 * (`ProjectArtifacts`, built once over every member); `scalarTypes`,
 * `authoringContributions`, and `controlMutationDefaults` are not consumed
 * by parsing — they are the control-stack projection semantic tokens and
 * completions classify against.
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
  readonly parseDiagnostics: readonly LspDiagnostic[];
}

/**
 * Parses one file exactly as the contract-psl provider does, so the editor
 * and the build agree. Never throws on malformed input — `parse` recovers.
 *
 * Symbol-table diagnostics are a project-wide concern: `ProjectArtifacts`
 * builds one symbol table over every member and distributes its diagnostics
 * per file by filename, so this stays parse-only — a per-document symbol
 * table here would be redundant with (and a strict subset of) that.
 */
export function runPipeline(filename: string, text: string): PipelineResult {
  const { document, sources, diagnostics: parseDiagnostics } = parse(text, filename);
  const sourceFile = sources.sourceFileFor(document.syntax);

  return {
    document,
    sourceFile,
    sources,
    parseDiagnostics: mapParseDiagnostics(parseDiagnostics),
  };
}
