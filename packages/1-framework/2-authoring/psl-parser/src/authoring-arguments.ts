import {
  type AuthoringArgumentDescriptor,
  type AuthoringTypeChoiceOption,
  type DataTypeSupport,
  readWrittenValueAs,
} from '@internal/framework-components/authoring';
import { dataTypeId } from '@internal/framework-components/codec';
import type { PslSpan } from '@internal/framework-components/psl-ast';
import { InternalError } from '@internal/utils/internal-error';
import { bindCallArguments } from './call-arguments';
import type { DiagnosticSource, PslDiagnosticCollector } from './diagnostic';
import { readExpressionAs } from './read-expression-as';
import { nodePslSpan, type ResolvedAttributeArg } from './resolve';
import type { SyntaxNode } from './syntax/red';

const INVALID_AUTHORING_ARGUMENT = Symbol('invalidAuthoringArgument');

/** An argument of a type constructor, or of a type choice, whose options are written as bare names. */
type CallArgumentDescriptor = AuthoringArgumentDescriptor | AuthoringTypeChoiceOption;

/** Why a written value is not one of the names an option takes, and, for a number that only one value argument takes, that argument. */
function misplacedOptionMessage(
  descriptors: readonly CallArgumentDescriptor[],
  dataTypes: DataTypeSupport,
  option: AuthoringTypeChoiceOption,
  written: string,
  argumentLabel: string,
): string {
  const refused = `${argumentLabel} is ${written}, but argument "${option.name}" takes one of these names, written without quotes: ${option.values.join(', ')}.`;
  if (!/^[+-]?\d/.test(written)) return refused;
  const takers = descriptors.flatMap((descriptor) =>
    descriptor.kind === 'value' &&
    descriptor.name !== undefined &&
    readWrittenValueAs(dataTypes, dataTypeId(descriptor.dataType), {
      kind: 'number',
      text: written,
    }).ok
      ? [descriptor.name]
      : [],
  );
  const [taker] = takers;
  return takers.length === 1 && taker !== undefined
    ? `${refused} Write ${taker} by name, as in ${taker}: ${written}.`
    : refused;
}

/** Where a reader of a call's arguments reports what it refuses: at the call, at an argument, or at a value whose data type refuses it. */
interface ArgumentRefusals {
  call(message: string): void;
  argument(span: PslSpan, message: string): void;
  value(node: SyntaxNode, failure: { readonly code: string; readonly message: string }): void;
}

interface ReadPslHelperArgsInput {
  readonly args: readonly ResolvedAttributeArg[];
  readonly descriptors: readonly CallArgumentDescriptor[];
  /** The stack's data types, which a `value` argument is read as. ADR 254. */
  readonly dataTypes: DataTypeSupport;
}

interface MapPslHelperArgsInput extends ReadPslHelperArgsInput {
  readonly helperLabel: string;
  readonly span: PslSpan;
  readonly diagnostics: PslDiagnosticCollector;
  readonly source: DiagnosticSource;
  readonly entityLabel: string;
}

const SILENT_REFUSALS: ArgumentRefusals = {
  call: () => {},
  argument: () => {},
  value: () => {},
};

/**
 * The value of one argument as `descriptor` reads it: a `value` argument as a value of its data type, read from its expression as attribute arguments are, and a type choice's option as a bare name. A refusal is reported at the argument.
 */
function readPslHelperArgument(
  input: ReadPslHelperArgsInput,
  refusals: ArgumentRefusals,
  descriptor: CallArgumentDescriptor,
  argument: ResolvedAttributeArg,
  argumentLabel: string,
): unknown | typeof INVALID_AUTHORING_ARGUMENT {
  const refuse = (message: string): typeof INVALID_AUTHORING_ARGUMENT => {
    refusals.argument(argument.span, message);
    return INVALID_AUTHORING_ARGUMENT;
  };

  if (descriptor.kind === 'option') {
    const written = argument.value.trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(written)) return written;
    return refuse(
      misplacedOptionMessage(
        input.descriptors,
        input.dataTypes,
        descriptor,
        written,
        argumentLabel,
      ),
    );
  }

  const { expression } = argument;
  if (expression === undefined && argument.node !== undefined) {
    return refuse(`${argumentLabel} has no value.`);
  }
  if (expression === undefined) {
    throw new InternalError(
      `A call received ${argumentLabel} with no expression. A value argument is read from the expression a schema writes; a reader that builds a call must pass the arguments it parsed, or instantiate the constructor with values.`,
    );
  }
  const read = readExpressionAs(input.dataTypes, dataTypeId(descriptor.dataType), expression);
  if (read.ok) return read.value.value;
  refusals.value(expression.syntax, read.failure);
  return INVALID_AUTHORING_ARGUMENT;
}

function readPslHelperArgsReporting(
  input: ReadPslHelperArgsInput,
  refusals: ArgumentRefusals,
): readonly unknown[] | undefined {
  const bound = bindCallArguments(
    input.args,
    input.descriptors.map((descriptor) => descriptor?.name),
  );
  const mappedArgs: unknown[] = input.descriptors.map(() => undefined);
  for (const { argument, index } of bound.ok ? bound.value : bound.failure.bound) {
    const descriptor = input.descriptors[index];
    if (!descriptor) {
      refusals.argument(argument.span, `does not define positional argument #${index + 1}.`);
      return undefined;
    }
    const label =
      argument.kind === 'named' ? `named argument "${argument.name}"` : `argument #${index + 1}`;
    const value = readPslHelperArgument(input, refusals, descriptor, argument, label);
    if (value === INVALID_AUTHORING_ARGUMENT) return undefined;
    mappedArgs[index] = value;
  }
  if (bound.ok) return mappedArgs;

  const failure = bound.failure;
  switch (failure.kind) {
    case 'tooManyPositional':
      refusals.call(
        `accepts at most ${input.descriptors.length} argument(s), received ${failure.received}.`,
      );
      return undefined;
    case 'unknownName':
      refusals.argument(
        failure.argument.span,
        `received unknown named argument "${failure.argument.name}".`,
      );
      return undefined;
    case 'filledTwice':
      refusals.argument(
        failure.argument.span,
        `received duplicate value for argument "${failure.argument.name}".`,
      );
      return undefined;
  }
}

/**
 * The arguments of a type constructor or type choice call, positional and named, each read as its descriptor says. `undefined`, with a diagnostic pushed, when one cannot be read or does not match a descriptor.
 */
export function mapPslHelperArgs(input: MapPslHelperArgsInput): readonly unknown[] | undefined {
  const refused = (span: PslSpan, message: string) =>
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${input.entityLabel} ${input.helperLabel} ${message}`,
      ...input.source.at(span),
    });
  return readPslHelperArgsReporting(input, {
    call: (message) => refused(input.span, message),
    argument: refused,
    value: (node, failure) =>
      input.diagnostics.push({
        code: failure.code,
        message: failure.message,
        ...input.source.at(nodePslSpan(node, input.source.sources)),
      }),
  });
}

/**
 * The arguments of a call read as {@link mapPslHelperArgs} reads them, without reporting what it refuses: `undefined` when the call does not read, which the reader that resolves the column reports.
 */
export function readPslHelperArgs(input: ReadPslHelperArgsInput): readonly unknown[] | undefined {
  return readPslHelperArgsReporting(input, SILENT_REFUSALS);
}
