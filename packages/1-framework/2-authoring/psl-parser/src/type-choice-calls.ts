import {
  type DataTypeSupport,
  instantiateAuthoringTypeConstructor,
  resolveAuthoringTypeChoice,
  type ScalarTypeConstructorOutput,
  unknownTypeChoiceArgumentMessage,
  validateAuthoringTypeChoiceParams,
} from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import type { PslSpan } from '@internal/framework-components/psl-ast';
import { isInternalError } from '@internal/utils/internal-error';
import { mapPslHelperArgs } from './authoring-arguments';
import type { ContributedTypeChoiceSymbol } from './contributed-type-scope';
import type { DiagnosticSource, PslDiagnosticCollector } from './diagnostic';
import type { ResolvedTypeConstructorCall } from './resolve';

/** The span of the argument at `index` of `descriptors` in `call`, named or positional, or the call's when it is not written. */
export function argumentSpan(
  call: ResolvedTypeConstructorCall,
  descriptors: readonly { readonly name?: string | undefined }[] | undefined,
  index: number | undefined,
): PslSpan {
  if (index === undefined) return call.span;
  const name = descriptors?.[index]?.name;
  const named = call.args.find((arg) => arg.kind === 'named' && arg.name === name);
  const positional = call.args.filter((arg) => arg.kind === 'positional')[index];
  return (named ?? positional)?.span ?? call.span;
}

/** The index of the argument an authoring refusal names, when it names one. */
export function argumentIndexOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('details' in error)) return undefined;
  const { details } = error;
  if (typeof details !== 'object' || details === null || !('argumentIndex' in details)) {
    return undefined;
  }
  return typeof details.argumentIndex === 'number' ? details.argumentIndex : undefined;
}

/**
 * The column a field or type alias typed by the type choice `symbol` gets: its call's arguments, read as the choice declares them, choose a type constructor, which is instantiated with the arguments the choice passes on. A refusal is reported at the argument that makes it. `span` is where a bare use is written.
 */
export function instantiatePslTypeChoice(input: {
  readonly symbol: ContributedTypeChoiceSymbol;
  readonly call: ResolvedTypeConstructorCall | undefined;
  readonly span: PslSpan;
  readonly codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'>;
  readonly diagnostics: PslDiagnosticCollector;
  readonly source: DiagnosticSource;
  readonly entityLabel: string;
  readonly dataTypes: DataTypeSupport;
}): ScalarTypeConstructorOutput | undefined {
  const { symbol } = input;
  const { descriptor } = symbol;
  const helperPath = symbol.path.join('.');
  const call = input.call ?? { path: symbol.path, args: [], span: input.span };
  const subject = `${input.entityLabel} type "${helperPath}"`;
  const unknown = call.args.find(
    (arg) =>
      arg.kind === 'named' && !descriptor.args.some((declared) => declared.name === arg.name),
  );
  if (unknown?.name !== undefined) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: unknownTypeChoiceArgumentMessage(subject, descriptor, unknown.name),
      ...input.source.at(unknown.span),
    });
    return undefined;
  }
  const args = mapPslHelperArgs({
    args: call.args,
    descriptors: descriptor.args,
    helperLabel: `type "${helperPath}"`,
    span: call.span,
    diagnostics: input.diagnostics,
    source: input.source,
    entityLabel: input.entityLabel,
    dataTypes: input.dataTypes,
  });
  if (!args) return undefined;

  let chosen: ReturnType<typeof resolveAuthoringTypeChoice>;
  try {
    chosen = resolveAuthoringTypeChoice({
      helperPath,
      descriptor,
      args,
      constructorNamed: (name) => symbol.choiceTypes.get(name),
    });
  } catch (error) {
    if (isInternalError(error)) throw error;
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${subject}: ${error instanceof Error ? error.message : String(error)}`,
      ...input.source.at(argumentSpan(call, descriptor.args, argumentIndexOf(error))),
    });
    return undefined;
  }

  const output = instantiateAuthoringTypeConstructor(chosen.descriptor, chosen.args);
  try {
    validateAuthoringTypeChoiceParams(
      helperPath,
      descriptor,
      chosen.descriptor,
      output.typeParams,
      input.codecLookup.descriptorFor(output.codecId)?.paramsSchema,
    );
  } catch (error) {
    if (isInternalError(error)) throw error;
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${subject}: ${error instanceof Error ? error.message : String(error)}`,
      ...input.source.at(argumentSpan(call, descriptor.args, argumentIndexOf(error))),
    });
    return undefined;
  }
  return output;
}
