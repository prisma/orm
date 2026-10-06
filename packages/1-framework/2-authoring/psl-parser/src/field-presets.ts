import {
  type AuthoringFieldPresetDescriptor,
  instantiateAuthoringFieldPreset,
  validateAuthoringHelperArguments,
} from '@internal/framework-components/authoring';
import type { PslSpan } from '@internal/framework-components/psl-ast';
import { mapPslHelperArgs } from './authoring-arguments';
import type { DiagnosticSource, PslDiagnosticCollector } from './diagnostic';
import type { ResolvedTypeConstructorCall } from './resolve';

export function reportPresetNotCalled(input: {
  readonly entityLabel: string;
  readonly presetPath: string;
  readonly source: DiagnosticSource;
  readonly span: PslSpan;
  readonly diagnostics: PslDiagnosticCollector;
}): void {
  input.diagnostics.push({
    code: 'PSL_PRESET_NOT_CALLED',
    message: `${input.entityLabel} uses field preset "${input.presetPath}" without calling it. Write ${input.presetPath}().`,
    ...input.source.at(input.span),
  });
}

/**
 * Instantiates a field-preset call against its descriptor, coercing PSL AST arguments into the descriptor's typed argument shape and returning the preset's full set of contract contributions.
 *
 * PSL → typed-args coercion happens here (via `mapPslHelperArgs`) so that `instantiateAuthoringFieldPreset` itself stays typed-input-only and TS keeps its zero-runtime-validation cost.
 */
export function instantiatePslFieldPreset(input: {
  readonly call: ResolvedTypeConstructorCall;
  readonly descriptor: AuthoringFieldPresetDescriptor;
  readonly diagnostics: PslDiagnosticCollector;
  readonly source: DiagnosticSource;
  readonly entityLabel: string;
}): ReturnType<typeof instantiateAuthoringFieldPreset> | undefined {
  const helperPath = input.call.path.join('.');
  const args = mapPslHelperArgs({
    args: input.call.args,
    descriptors: input.descriptor.args ?? [],
    helperLabel: `preset "${helperPath}"`,
    span: input.call.span,
    diagnostics: input.diagnostics,
    source: input.source,
    entityLabel: input.entityLabel,
  });
  if (!args) {
    return undefined;
  }

  try {
    validateAuthoringHelperArguments(helperPath, input.descriptor.args, args);
    return instantiateAuthoringFieldPreset(input.descriptor, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${input.entityLabel}: ${message}`,
      ...input.source.at(input.call.span),
    });
    return undefined;
  }
}
