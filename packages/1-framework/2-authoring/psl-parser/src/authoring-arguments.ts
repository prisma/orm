import type {
  AuthoringArgumentDescriptor,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import { dataTypeId } from '@internal/framework-components/codec';
import type { PslSpan } from '@internal/framework-components/psl-ast';
import { InternalError } from '@internal/utils/internal-error';
import { bindCallArguments } from './call-arguments';
import type { DiagnosticSource, PslDiagnosticCollector } from './diagnostic';
import { readExpressionAs } from './read-expression-as';
import { nodePslSpan, type ResolvedAttributeArg } from './resolve';

const INVALID_AUTHORING_ARGUMENT = Symbol('invalidAuthoringArgument');

function pushInvalidPslHelperArgument(input: {
  readonly diagnostics: PslDiagnosticCollector;
  readonly source: DiagnosticSource;
  readonly span: PslSpan;
  readonly entityLabel: string;
  readonly helperLabel: string;
  readonly message: string;
}): undefined {
  input.diagnostics.push({
    code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
    message: `${input.entityLabel} ${input.helperLabel} ${input.message}`,
    ...input.source.at(input.span),
  });
  return undefined;
}

interface MapPslHelperArgsInput {
  readonly args: readonly ResolvedAttributeArg[];
  readonly descriptors: readonly AuthoringArgumentDescriptor[];
  readonly helperLabel: string;
  readonly span: PslSpan;
  readonly diagnostics: PslDiagnosticCollector;
  readonly source: DiagnosticSource;
  readonly entityLabel: string;
  /** The stack's data types, which a `value` argument is read as. ADR 254. */
  readonly dataTypes: DataTypeSupport;
}

/**
 * The value of one argument as a value of its descriptor's data type, read from its expression as attribute arguments are. A refusal is pushed as a diagnostic at the argument.
 */
function readPslHelperArgument(
  input: MapPslHelperArgsInput,
  descriptor: AuthoringArgumentDescriptor,
  argument: ResolvedAttributeArg,
  argumentLabel: string,
): unknown | typeof INVALID_AUTHORING_ARGUMENT {
  const { expression } = argument;
  if (expression === undefined && argument.node !== undefined) {
    pushInvalidPslHelperArgument({
      diagnostics: input.diagnostics,
      source: input.source,
      span: argument.span,
      entityLabel: input.entityLabel,
      helperLabel: input.helperLabel,
      message: `${argumentLabel} has no value.`,
    });
    return INVALID_AUTHORING_ARGUMENT;
  }
  if (expression === undefined) {
    throw new InternalError(
      `${input.entityLabel} ${input.helperLabel} received ${argumentLabel} with no expression. A value argument is read from the expression a schema writes; a reader that builds a call must pass the arguments it parsed, or instantiate the constructor with values.`,
    );
  }
  const read = readExpressionAs(input.dataTypes, dataTypeId(descriptor.dataType), expression);
  if (read.ok) return read.value.value;
  input.diagnostics.push({
    code: read.failure.code,
    message: read.failure.message,
    ...input.source.at(nodePslSpan(expression.syntax, input.source.sources)),
  });
  return INVALID_AUTHORING_ARGUMENT;
}

/**
 * The arguments of a type constructor call, positional and named, each read as its descriptor says. `undefined`, with a diagnostic pushed, when one cannot be read or does not match a descriptor.
 */
export function mapPslHelperArgs(input: MapPslHelperArgsInput): readonly unknown[] | undefined {
  const refuse = (span: PslSpan, message: string) =>
    pushInvalidPslHelperArgument({
      diagnostics: input.diagnostics,
      source: input.source,
      span,
      entityLabel: input.entityLabel,
      helperLabel: input.helperLabel,
      message,
    });

  const bound = bindCallArguments(
    input.args,
    input.descriptors.map((descriptor) => descriptor?.name),
  );
  const mappedArgs: unknown[] = input.descriptors.map(() => undefined);
  for (const { argument, index } of bound.ok ? bound.value : bound.failure.bound) {
    const descriptor = input.descriptors[index];
    if (!descriptor) {
      return refuse(argument.span, `does not define positional argument #${index + 1}.`);
    }
    const label =
      argument.kind === 'named' ? `named argument "${argument.name}"` : `argument #${index + 1}`;
    const value = readPslHelperArgument(input, descriptor, argument, label);
    if (value === INVALID_AUTHORING_ARGUMENT) return undefined;
    mappedArgs[index] = value;
  }
  if (bound.ok) return mappedArgs;

  const failure = bound.failure;
  switch (failure.kind) {
    case 'tooManyPositional':
      return refuse(
        input.span,
        `accepts at most ${input.descriptors.length} argument(s), received ${failure.received}.`,
      );
    case 'unknownName':
      return refuse(
        failure.argument.span,
        `received unknown named argument "${failure.argument.name}".`,
      );
    case 'filledTwice':
      return refuse(
        failure.argument.span,
        `received duplicate value for argument "${failure.argument.name}".`,
      );
  }
}
