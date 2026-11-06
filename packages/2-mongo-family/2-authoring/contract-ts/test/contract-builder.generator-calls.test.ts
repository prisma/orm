import type { TargetPackRef } from '@internal/framework-components/components';
import { singleGeneratorBinding } from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { mongoTestCodecDescriptors } from '@internal/mongo-contract/test';
import { type } from 'arktype';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { type ContractAuthoringHelpers, defineContract } from '../src/contract-builder';
import { mongoTargetPack as baseTargetPack, mongoFamilyPack } from './mongo-test-packs';

const mongoTargetPack = {
  ...baseTargetPack,
  generatorFunctions: [
    {
      name: 'now',
      signature: { documentation: 'now' },
      bindings: [
        singleGeneratorBinding({ codecIds: ['mongo/date@1'], generatorId: 'timestampNow' }),
      ],
    },
  ],
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: [{ id: 'timestampNow' }],
  },
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

type Helpers = ContractAuthoringHelpers<typeof mongoFamilyPack, typeof mongoTargetPack>;

const timestampNow = { kind: 'generator', id: 'timestampNow' } as const;

function contractWith(fieldsOf: (helpers: Helpers) => Parameters<Helpers['model']>[1]['fields']) {
  return defineContract({ family: mongoFamilyPack, target: mongoTargetPack }, (helpers) => ({
    models: {
      Post: helpers.model('Post', {
        collection: 'posts',
        fields: { _id: helpers.field.objectId(), ...fieldsOf(helpers) },
      }),
    },
  }));
}

function helpersOf(): Helpers {
  let captured: Helpers | undefined;
  defineContract({ family: mongoFamilyPack, target: mongoTargetPack }, (helpers) => {
    captured = helpers;
    return { models: {} };
  });
  if (captured === undefined) throw new Error('defineContract did not call its factory');
  return captured;
}

describe('Mongo gen', () => {
  it('holds only the functions the stack declares', () => {
    const { gen } = helpersOf();
    expectTypeOf<keyof typeof gen>().toEqualTypeOf<'now'>();
    expect({ names: Object.keys(gen), now: gen.now() }).toEqual({
      names: ['now'],
      now: { name: 'now', args: {} },
    });
  });
});

describe('Mongo .onCreate and .onUpdate', () => {
  it('resolve now() on a date field for each phase, as temporal.updatedAt() does', () => {
    expect(
      contractWith(({ field, gen }) => ({
        updatedAt: field.date().onCreate(gen.now()).onUpdate(gen.now()),
      })).execution?.mutations.defaults,
    ).toEqual([
      {
        ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'posts', field: 'updatedAt' },
        onCreate: timestampNow,
        onUpdate: timestampNow,
      },
    ]);
  });

  it('refuse a function the codec does not bind', () => {
    expect(() =>
      contractWith(({ field, gen }) => ({
        title: field.scalar('mongo/string@1').onCreate(gen.now()),
      })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: {
          modelName: 'Post',
          fieldName: 'title',
          codecId: 'mongo/string@1',
          function: 'now',
          reason: 'generator-not-applicable',
        },
      }),
    );
  });

  it('refuse a phase set twice', () => {
    const { field, gen } = helpersOf();
    expect(() => field.date().onUpdate(gen.now()).onUpdate(gen.now())).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          '.onUpdate() is called on a field that already generates a value on update. Set each phase once, and do not combine .onUpdate() with a type alias or alias constant that sets it.',
        meta: { reason: 'generator-phase-set-twice', phase: 'onUpdate' },
      }),
    );
  });
});

describe('Mongo contributed type aliases', () => {
  function contractWithVectorAlias(dimensions: number) {
    const target = {
      ...mongoTargetPack,
      types: {
        codecTypes: {
          codecDescriptors: mongoTestCodecDescriptors.map((descriptor) =>
            descriptor.codecId === 'mongo/vector@1'
              ? { ...descriptor, paramsSchema: type({ dimensions: 'number.integer > 0' }) }
              : descriptor,
          ),
        },
      },
      authoring: {
        type: {
          vectors: {
            Fixed: {
              kind: 'typeAlias',
              output: { type: { codecId: 'mongo/vector@1', typeParams: { dimensions } } },
            },
          },
        },
      },
    } as const satisfies TargetPackRef<'mongo', 'mongo'>;
    return () => defineContract({ family: mongoFamilyPack, target }, () => ({ models: {} }));
  }

  it('build when the codec takes the fixed type params', () => {
    expect(contractWithVectorAlias(3)).not.toThrow();
  });

  it('are refused at assembly when the codec refuses the fixed type params', () => {
    expect(contractWithVectorAlias(0)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Type alias "vectors.Fixed" fixes type parameters its codec "mongo/vector@1" refuses: dimensions must be positive (was 0)',
      }),
    );
  });

  it('are refused at assembly when a generator call does not apply to the codec', () => {
    const target = {
      ...mongoTargetPack,
      authoring: {
        type: {
          temporal: {
            Broken: {
              kind: 'typeAlias',
              output: {
                type: { codecId: 'mongo/string@1' },
                onUpdate: { name: 'now', args: {} },
              },
            },
          },
        },
      },
    } as const satisfies TargetPackRef<'mongo', 'mongo'>;
    expect(() =>
      defineContract({ family: mongoFamilyPack, target }, () => ({ models: {} })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Type alias "temporal.Broken" calls now() on update, which does not apply to its codec "mongo/string@1".',
      }),
    );
  });
});
