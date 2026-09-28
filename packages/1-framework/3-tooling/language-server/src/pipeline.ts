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
