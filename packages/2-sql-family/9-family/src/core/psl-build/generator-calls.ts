import type {
  ExecutionMutationDefaultPhases,
  ExecutionMutationDefaultValue,
} from '@internal/contract/types';
import type {
  GeneratorFunctionField,
  GeneratorFunctionRegistry,
  GeneratorPhase,
} from '@internal/framework-components/components';
import { canonicalizeJson } from '@internal/framework-components/utils';

const GENERATOR_PHASES: readonly GeneratorPhase[] = ['onCreate', 'onUpdate'];

/** The call text that writes one phase of a column's generators. */
export interface PhaseCallText {
  readonly phase: GeneratorPhase;
  readonly text: string;
}

export type GeneratorCallRefusal =
  | {
      readonly kind: 'on-list' | 'no-function';
      readonly phase: GeneratorPhase;
      readonly generator: ExecutionMutationDefaultValue;
    }
  | {
      readonly kind: 'reads-back-differently';
      readonly phase: GeneratorPhase;
      readonly generator: ExecutionMutationDefaultValue;
      readonly text: string;
      readonly readBack: ExecutionMutationDefaultValue | undefined;
      /** Why the call's binding refuses the column, when it does. */
      readonly refusedBecause: string | undefined;
    };

export type GeneratorCallsResult =
  | { readonly ok: true; readonly calls: readonly PhaseCallText[] }
  | { readonly ok: false; readonly refusal: GeneratorCallRefusal };

/**
 * The generator function call that writes each phase of a column's generators, as `@onCreate(...)` and `@onUpdate(...)` take it. A call must resolve back to the stored generator, so a list column, a generator no function writes for the codec, and a call that reads back differently are refused.
 */
export function generatorCallsFor(input: {
  readonly executionDefault: ExecutionMutationDefaultPhases;
  readonly field: GeneratorFunctionField;
  readonly list: boolean;
  readonly generatorFunctions: GeneratorFunctionRegistry;
}): GeneratorCallsResult {
  const { executionDefault, field, list, generatorFunctions } = input;
  const calls: PhaseCallText[] = [];
  for (const phase of GENERATOR_PHASES) {
    const generator = executionDefault[phase];
    if (generator === undefined) continue;
    if (list) return { ok: false, refusal: { kind: 'on-list', phase, generator } };
    const printed = generatorFunctions.callFor(generator, field);
    if (printed === undefined) {
      return { ok: false, refusal: { kind: 'no-function', phase, generator } };
    }
    const readBack = generatorFunctions.resolve(printed.call, field);
    if (!readBack.ok || canonicalizeJson(readBack.generator) !== canonicalizeJson(generator)) {
      return {
        ok: false,
        refusal: {
          kind: 'reads-back-differently',
          phase,
          generator,
          text: printed.text,
          readBack: readBack.ok ? readBack.generator : undefined,
          refusedBecause:
            !readBack.ok && readBack.reason === 'refused' ? readBack.message : undefined,
        },
      };
    }
    calls.push({ phase, text: printed.text });
  }
  return { ok: true, calls };
}
