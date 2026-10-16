import type { ExecutionMutationDefault } from '@internal/contract/types';
import type { SqlPslBuildContext } from '@internal/family-sql/control';
import {
  defaultFunctionCallFor,
  type FieldPresetArgument,
  fieldPresetCallFor,
  type PslColumnTypeRef,
} from '@internal/family-sql/psl-build';
import type {
  PslAttributeArgument,
  PslFieldAttribute,
} from '@internal/framework-components/psl-ast';
import { buildAttribute, namedArg, positionalArg } from '../psl-build/psl-literals';
import {
  refuseGeneratorOnUpdate,
  refuseGeneratorsNoPresetWritesTogether,
  refuseGeneratorWithoutPslFunction,
  refusePresetCallReadingBackDifferently,
  refuseUnwritablePresetCall,
} from './refusals';

export type BuiltExecutionDefault =
  | { readonly kind: 'attribute'; readonly attribute: PslFieldAttribute }
  | {
      readonly kind: 'preset';
      readonly path: readonly string[];
      readonly args: readonly PslAttributeArgument[];
    };

function toPslArgument(argument: FieldPresetArgument): PslAttributeArgument {
  return argument.kind === 'positional'
    ? positionalArg(argument.value)
    : namedArg(argument.name, argument.value);
}

/**
 * How one column's execution generators are written in PSL: as the call of the field preset of the stack that writes the column's codec with them, or else a create-only generator as the `@default(<fn>(...))` call of the default function that declares `printArguments` for it. A column neither writes is refused, with the preset's reason when a preset writes its codec and generators.
 */
export function buildExecutionDefault(input: {
  readonly executionDefault: ExecutionMutationDefault;
  readonly codecId: string;
  readonly pslType: PslColumnTypeRef;
  readonly list: boolean;
  readonly typeParams: Readonly<Record<string, unknown>> | undefined;
  readonly coordinate: string;
  readonly context: SqlPslBuildContext;
}): BuiltExecutionDefault {
  const { executionDefault, codecId, pslType, list, typeParams, coordinate, context } = input;
  const onCreateId = executionDefault.onCreate?.id;
  const onUpdateId = executionDefault.onUpdate?.id;
  const phases = { coordinate, onCreate: onCreateId, onUpdate: onUpdateId };

  const choice = fieldPresetCallFor({
    fieldPresetsByCodecAndGenerator: context.fieldPresetsByCodecAndGenerator,
    column: { codecId, pslType, list, typeParams, generators: executionDefault },
  });
  if (choice.kind === 'call') {
    return { kind: 'preset', path: choice.preset.path, args: choice.arguments.map(toPslArgument) };
  }

  const call =
    onCreateId === undefined || onUpdateId !== undefined
      ? undefined
      : defaultFunctionCallFor(
          context.defaultFunctionPrintersByGenerator,
          onCreateId,
          executionDefault.onCreate?.params,
        );
  if (call !== undefined) {
    return {
      kind: 'attribute',
      attribute: buildAttribute('field', 'default', [positionalArg(call)]),
    };
  }

  switch (choice.kind) {
    case 'cannotWrite':
      if (choice.reason.kind === 'phasesNotWrittenTogether') {
        return refuseGeneratorsNoPresetWritesTogether(phases);
      }
      return refuseUnwritablePresetCall({
        coordinate,
        preset: choice.preset.path.join('.'),
        reason: choice.reason,
      });
    case 'readsBackDifferently':
      return refusePresetCallReadingBackDifferently({
        coordinate,
        preset: choice.preset.path.join('.'),
        differences: choice.differences,
      });
    case 'noPreset':
      if (onUpdateId !== undefined) return refuseGeneratorOnUpdate(phases);
      return refuseGeneratorWithoutPslFunction({
        ...phases,
        registeredBy:
          onCreateId !== undefined && context.componentIdsByGenerator.has(onCreateId)
            ? { componentId: context.componentIdsByGenerator.get(onCreateId) }
            : undefined,
      });
  }
}
