import {
  assembleGeneratorFunctions,
  singleGeneratorBinding,
} from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { generatorCallsFor } from '../../src/core/psl-build/generator-calls';

const generatorFunctions = assembleGeneratorFunctions([
  {
    id: 'demo',
    generatorFunctions: [
      {
        name: 'now',
        signature: {},
        bindings: [
          singleGeneratorBinding({
            codecIds: ['demo/time@1'],
            generatorId: 'timeNow',
            paramsFromField: (field) =>
              typeof field.typeParams?.['precision'] === 'number'
                ? { precision: field.typeParams['precision'] }
                : undefined,
          }),
        ],
      },
    ],
    controlMutationDefaults: { generatorDescriptors: [{ id: 'timeNow' }, { id: 'slugid' }] },
  },
]);

const timeNow = { kind: 'generator', id: 'timeNow' } as const;

function callsFor(input: {
  readonly onCreate?: typeof timeNow | { readonly kind: 'generator'; readonly id: string };
  readonly onUpdate?: typeof timeNow;
  readonly list?: boolean;
  readonly typeParams?: Record<string, unknown>;
}) {
  return generatorCallsFor({
    executionDefault: {
      ...(input.onCreate === undefined ? {} : { onCreate: input.onCreate }),
      ...(input.onUpdate === undefined ? {} : { onUpdate: input.onUpdate }),
    },
    field: { codecId: 'demo/time@1', typeParams: input.typeParams, length: undefined },
    list: input.list === true,
    generatorFunctions,
  });
}

describe('generatorCallsFor', () => {
  it('writes the call of the function that produces each phase', () => {
    expect(callsFor({ onCreate: timeNow, onUpdate: timeNow })).toEqual({
      ok: true,
      calls: [
        { phase: 'onCreate', text: 'now()' },
        { phase: 'onUpdate', text: 'now()' },
      ],
    });
  });

  it('refuses a list field', () => {
    expect(callsFor({ onCreate: timeNow, list: true })).toEqual({
      ok: false,
      refusal: { kind: 'on-list', phase: 'onCreate', generator: timeNow },
    });
  });

  it('refuses a generator no function writes for the codec', () => {
    const slugid = { kind: 'generator', id: 'slugid' } as const;
    expect(callsFor({ onCreate: slugid })).toEqual({
      ok: false,
      refusal: { kind: 'no-function', phase: 'onCreate', generator: slugid },
    });
  });

  it('refuses a call that reads back as another generator', () => {
    expect(callsFor({ onUpdate: timeNow, typeParams: { precision: 3 } })).toEqual({
      ok: false,
      refusal: {
        kind: 'reads-back-differently',
        phase: 'onUpdate',
        generator: timeNow,
        text: 'now()',
        readBack: { kind: 'generator', id: 'timeNow', params: { precision: 3 } },
        refusedBecause: undefined,
      },
    });
  });
});
