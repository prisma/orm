import type {
  ExecutionMutationDefaultPhases,
  ExecutionMutationDefaultValue,
} from '@internal/contract/types';
import {
  type FieldPresetPrintForm,
  type FieldPresetsByCodecAndGenerator,
  instantiateAuthoringFieldPreset,
  type PrintableFieldPreset,
  validateAuthoringHelperArguments,
} from '@internal/framework-components/authoring';
import { isRuntimeError } from '@internal/framework-components/components';
import type { DefaultFunctionPrinter } from '@internal/framework-components/control';
import { canonicalizeJson } from '@internal/framework-components/utils';
import { pslTypeArgumentText } from './inferred-type-constructors';

/** The PSL call of the default function that produces `generatorId` with `params`, or `undefined` when no default function in the stack writes it. */
export function defaultFunctionCallFor(
  defaultFunctionPrintersByGenerator: ReadonlyMap<string, DefaultFunctionPrinter>,
  generatorId: string,
  params: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const printer = defaultFunctionPrintersByGenerator.get(generatorId);
  return printer === undefined
    ? undefined
    : `${printer.functionName}(${printer.printArguments(params)})`;
}

export type FieldPresetArgument =
  | { readonly kind: 'positional'; readonly value: string }
  | { readonly kind: 'named'; readonly name: string; readonly value: string };

type ColumnPhase = 'onCreate' | 'onUpdate';

/**
 * What a column's PSL type stands for. `dataType` is a type that stands for the column's codec and type params alone, written as a bare name such as `String` or a call such as `Timestamptz(3)`. A named type, a value object or an enum, including a native enum written `pg.enum(<Block>)`, names something more.
 */
export type PslColumnTypeKind = 'dataType' | 'namedType' | 'valueObject' | 'enum';

/** The name a column's PSL type is written with, and what it stands for. */
export interface PslColumnTypeRef {
  readonly kind: PslColumnTypeKind;
  readonly typeName: string;
}

/** Why the call of the preset that writes a column's codec with its generators cannot be written. */
export type FieldPresetUnwritableReason =
  | {
      readonly kind: 'columnType';
      readonly columnType: Exclude<PslColumnTypeKind, 'dataType'>;
      readonly typeName: string;
    }
  | { readonly kind: 'list' }
  | { readonly kind: 'phasesNotWrittenTogether' }
  | { readonly kind: 'unwritableArgument'; readonly argument: string; readonly value: unknown }
  | { readonly kind: 'argumentsRejected'; readonly message: string };

/** A part of the column the preset call, once written, reads back differently. */
export type FieldPresetReadBackDifference =
  | { readonly part: 'codecId'; readonly column: string; readonly printed: string }
  | {
      readonly part: 'typeParams';
      readonly column: Readonly<Record<string, unknown>> | undefined;
      readonly printed: Readonly<Record<string, unknown>> | undefined;
    }
  | {
      readonly part: ColumnPhase;
      readonly column: ExecutionMutationDefaultValue | undefined;
      readonly printed: ExecutionMutationDefaultValue | undefined;
    };

/** How a column's generators are written with a field preset, or why they cannot be. */
export type FieldPresetCallChoice =
  | { readonly kind: 'noPreset' }
  | {
      readonly kind: 'call';
      readonly preset: PrintableFieldPreset;
      readonly arguments: readonly FieldPresetArgument[];
    }
  | {
      readonly kind: 'cannotWrite';
      readonly preset: PrintableFieldPreset;
      readonly reason: FieldPresetUnwritableReason;
    }
  | {
      readonly kind: 'readsBackDifferently';
      readonly preset: PrintableFieldPreset;
      readonly differences: readonly FieldPresetReadBackDifference[];
    };

interface FieldPresetColumn {
  readonly codecId: string;
  readonly pslType: PslColumnTypeRef;
  readonly list: boolean;
  readonly typeParams: Readonly<Record<string, unknown>> | undefined;
  readonly generators: ExecutionMutationDefaultPhases;
}

const PHASES: readonly ColumnPhase[] = ['onCreate', 'onUpdate'];

function sameParams(
  left: Readonly<Record<string, unknown>> | undefined,
  right: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return canonicalizeJson(left ?? {}) === canonicalizeJson(right ?? {});
}

function sameGenerator(
  left: ExecutionMutationDefaultValue | undefined,
  right: ExecutionMutationDefaultValue | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.id === right.id && sameParams(left.params, right.params);
}

function writesEveryPhase(printForm: FieldPresetPrintForm, column: FieldPresetColumn): boolean {
  return PHASES.every((phase) => {
    const generatorId = column.generators[phase]?.id;
    return generatorId === undefined || printForm[phase]?.valuesByGenerator.has(generatorId);
  });
}

interface WrittenArgument {
  readonly index: number;
  readonly value: unknown;
  readonly argument: FieldPresetArgument;
}

type WrittenArguments =
  | { readonly kind: 'written'; readonly arguments: readonly WrittenArgument[] }
  | { readonly kind: 'unwritable'; readonly argument: string; readonly value: unknown };

function writtenArguments(
  printForm: FieldPresetPrintForm,
  column: FieldPresetColumn,
): WrittenArguments {
  const positional: WrittenArgument[] = [];
  for (const [index, name] of printForm.typeParams.entries()) {
    const value = column.typeParams?.[name];
    if (value === undefined) break;
    const text = pslTypeArgumentText(value);
    if (text === undefined) return { kind: 'unwritable', argument: name, value };
    positional.push({ index, value, argument: { kind: 'positional', value: text } });
  }
  const named = PHASES.flatMap((phase): WrittenArgument[] => {
    const phasePrintForm = printForm[phase];
    const generatorId = column.generators[phase]?.id;
    const value =
      generatorId === undefined ? undefined : phasePrintForm?.valuesByGenerator.get(generatorId);
    if (phasePrintForm === undefined || value === undefined) return [];
    const { argument: name, index } = phasePrintForm;
    return [{ index, value, argument: { kind: 'named', name, value } }];
  });
  return { kind: 'written', arguments: [...positional, ...named] };
}

function rejectionOf(preset: PrintableFieldPreset, args: readonly unknown[]): string | undefined {
  try {
    validateAuthoringHelperArguments(preset.path.join('.'), preset.descriptor.args, args);
    return undefined;
  } catch (error) {
    if (isRuntimeError(error) && error.code === 'CONTRACT.ARGUMENT_INVALID') return error.message;
    throw error;
  }
}

function readBackDifferences(
  preset: PrintableFieldPreset,
  column: FieldPresetColumn,
  args: readonly unknown[],
): readonly FieldPresetReadBackDifference[] {
  const printed = instantiateAuthoringFieldPreset(preset.descriptor, args);
  const printedGenerators = printed.executionDefaults ?? {};
  return [
    ...(printed.descriptor.codecId === column.codecId
      ? []
      : [
          {
            part: 'codecId' as const,
            column: column.codecId,
            printed: printed.descriptor.codecId,
          },
        ]),
    ...(sameParams(column.typeParams, printed.descriptor.typeParams)
      ? []
      : [
          {
            part: 'typeParams' as const,
            column: column.typeParams,
            printed: printed.descriptor.typeParams,
          },
        ]),
    ...PHASES.flatMap((phase) =>
      sameGenerator(column.generators[phase], printedGenerators[phase])
        ? []
        : [{ part: phase, column: column.generators[phase], printed: printedGenerators[phase] }],
    ),
  ];
}

function cannotWrite(
  preset: PrintableFieldPreset,
  reason: FieldPresetUnwritableReason,
): FieldPresetCallChoice {
  return { kind: 'cannotWrite', preset, reason };
}

/**
 * The call of the field preset in the stack that writes a column's codec with its generators. The call is written only for a column that is not a list and whose PSL type stands for its data type, which the preset call takes the place of, and when the preset accepts its arguments as the PSL reader checks them; it is then checked to read back with the column's codec, type params and generators with their params, where absent and empty params count as the same. Otherwise the reason it cannot be written that way.
 */
export function fieldPresetCallFor(input: {
  readonly fieldPresetsByCodecAndGenerator: FieldPresetsByCodecAndGenerator;
  readonly column: FieldPresetColumn;
}): FieldPresetCallChoice {
  const { column } = input;
  const byGenerator = input.fieldPresetsByCodecAndGenerator.get(column.codecId);
  const preset = PHASES.map((phase) => column.generators[phase]?.id)
    .map((generatorId) => (generatorId === undefined ? undefined : byGenerator?.get(generatorId)))
    .find((found) => found !== undefined);
  if (preset === undefined) return { kind: 'noPreset' };
  const { pslType } = column;
  if (pslType.kind !== 'dataType') {
    return cannotWrite(preset, {
      kind: 'columnType',
      columnType: pslType.kind,
      typeName: pslType.typeName,
    });
  }
  if (column.list) return cannotWrite(preset, { kind: 'list' });
  if (!writesEveryPhase(preset.printForm, column)) {
    return cannotWrite(preset, { kind: 'phasesNotWrittenTogether' });
  }
  const written = writtenArguments(preset.printForm, column);
  if (written.kind === 'unwritable') {
    return cannotWrite(preset, {
      kind: 'unwritableArgument',
      argument: written.argument,
      value: written.value,
    });
  }
  const args: unknown[] = [];
  for (const { index, value } of written.arguments) args[index] = value;
  const rejection = rejectionOf(preset, args);
  if (rejection !== undefined) {
    return cannotWrite(preset, { kind: 'argumentsRejected', message: rejection });
  }
  const differences = readBackDifferences(preset, column, args);
  if (differences.length > 0) return { kind: 'readsBackDifferently', preset, differences };
  return {
    kind: 'call',
    preset,
    arguments: written.arguments.map(({ argument }) => argument),
  };
}
