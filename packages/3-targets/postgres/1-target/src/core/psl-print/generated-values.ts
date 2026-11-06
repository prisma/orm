import type { ExecutionMutationDefault } from '@internal/contract/types';
import type { SqlPslBuildContext } from '@internal/family-sql/control';
import { type GeneratorCallRefusal, generatorCallsFor } from '@internal/family-sql/psl-build';
import type { PslFieldAttribute } from '@internal/framework-components/psl-ast';
import { sqlCodecColumnLength } from '@internal/sql-contract/data-type';
import { buildAttribute, positionalArg } from '../psl-build/psl-literals';
import {
  refuseGeneratorOnList,
  refuseGeneratorReadingBackDifferently,
  refuseGeneratorWithoutPslFunction,
} from './refusals';

function refuse(
  refusal: GeneratorCallRefusal,
  input: {
    readonly coordinate: string;
    readonly codecId: string;
    readonly context: SqlPslBuildContext;
  },
): never {
  const { coordinate, codecId, context } = input;
  const { phase, generator } = refusal;
  switch (refusal.kind) {
    case 'on-list':
      return refuseGeneratorOnList({ coordinate, phase, generatorId: generator.id });
    case 'no-function':
      return refuseGeneratorWithoutPslFunction({
        coordinate,
        phase,
        generatorId: generator.id,
        codecId,
        registeredBy: context.componentIdsByGenerator.has(generator.id)
          ? { componentId: context.componentIdsByGenerator.get(generator.id) }
          : undefined,
      });
    case 'reads-back-differently':
      return refuseGeneratorReadingBackDifferently({
        coordinate,
        phase,
        call: refusal.text,
        stored: generator,
        readBack: refusal.readBack,
        refusedBecause: refusal.refusedBecause,
      });
  }
}

/**
 * The `@onCreate(fn(...))` and `@onUpdate(fn(...))` attributes that write one column's generators. A column whose generators cannot be written as calls that read back the same is refused.
 */
export function buildGeneratorAttributes(input: {
  readonly executionDefault: ExecutionMutationDefault;
  readonly codecId: string;
  readonly list: boolean;
  readonly typeParams: Readonly<Record<string, unknown>> | undefined;
  readonly coordinate: string;
  readonly context: SqlPslBuildContext;
}): readonly PslFieldAttribute[] {
  const result = generatorCallsFor({
    executionDefault: input.executionDefault,
    field: {
      codecId: input.codecId,
      typeParams: input.typeParams,
      length: sqlCodecColumnLength(input.context.dataTypes, input.codecId, input.typeParams),
    },
    list: input.list,
    generatorFunctions: input.context.generatorFunctions,
  });
  if (!result.ok) refuse(result.refusal, input);
  return result.calls.map(({ phase, text }) =>
    buildAttribute('field', phase, [positionalArg(text)]),
  );
}
