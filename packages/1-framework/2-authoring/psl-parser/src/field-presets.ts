import {
  type AuthoringFieldPresetDescriptor,
  instantiateAuthoringFieldPreset,
  validateAuthoringHelperArguments,
} from '@internal/framework-components/authoring';
import type { PslSpan } from '@internal/framework-components/psl-ast';
import { mapPslHelperArgs } from './authoring-arguments';
import type { DiagnosticSource, PslDiagnostic, PslDiagnosticCollector } from './diagnostic';
import type { ResolvedTypeConstructorCall } from './resolve';

/**
 * Pushes the canonical `PSL_EXTENSION_NAMESPACE_NOT_COMPOSED` diagnostic for a subject (attribute, model attribute, or type constructor) that references an extension namespace which is not composed in the current contract.
 *
 * The `data` payload carries the missing namespace so machine consumers (agents, IDE extensions, CLI auto-fix) don't have to parse the prose.
 */
export function uncomposedNamespaceDiagnostic(input: {
  readonly subjectLabel: string;
  readonly namespace: string;
  readonly source: DiagnosticSource;
  readonly span: PslSpan;
}): PslDiagnostic {
  return {
    code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
    message: `${input.subjectLabel} uses unrecognized namespace "${input.namespace}". Add extension pack "${input.namespace}" to extensions in prisma.config.ts.`,
    ...input.source.at(input.span),
    data: { namespace: input.namespace, suggestedPack: input.namespace },
  };
}

export function reportUncomposedNamespace(input: {
  readonly subjectLabel: string;
  readonly namespace: string;
  readonly source: DiagnosticSource;
  readonly span: PslSpan;
  readonly diagnostics: PslDiagnosticCollector;
}): void {
  input.diagnostics.push(
    uncomposedNamespaceDiagnostic({
      subjectLabel: input.subjectLabel,
      namespace: input.namespace,
      source: input.source,
      span: input.span,
    }),
  );
}

/**
 * Pushes the canonical `PSL_UNKNOWN_FIELD_PRESET` diagnostic when a typoed preset name is referenced inside a registered field-preset namespace. The `data` payload exposes the namespace and full helper path so machine consumers (agents, IDE extensions) don't have to parse the prose.
 */
export function reportUnknownFieldPreset(input: {
  readonly entityLabel: string;
  readonly namespace: string;
  readonly helperPath: string;
  readonly source: DiagnosticSource;
  readonly span: PslSpan;
  readonly diagnostics: PslDiagnosticCollector;
}): void {
  input.diagnostics.push({
    code: 'PSL_UNKNOWN_FIELD_PRESET',
    message: `${input.entityLabel} references unknown field preset "${input.helperPath}". Check the spelling against the available presets in the "${input.namespace}" namespace.`,
    ...input.source.at(input.span),
    data: { namespace: input.namespace, helperPath: input.helperPath },
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
      message: `${input.entityLabel} preset "${helperPath}" ${message}`,
      ...input.source.at(input.call.span),
    });
    return undefined;
  }
}
