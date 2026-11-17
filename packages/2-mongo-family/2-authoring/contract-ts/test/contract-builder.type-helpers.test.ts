import {
  singleGeneratorBinding,
  type TargetPackRef,
} from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { createContractAuthoringHelpers, defineContract } from '../src/contract-builder';
import { mongoFamilyPack, mongoTargetPack, mongoTestScalarTypes } from './mongo-test-packs';
import { choicePack } from './type-helper-packs';

const generatingTargetPack = {
  ...mongoTargetPack,
  authoring: {
    ...mongoTargetPack.authoring,
    type: {
      ...mongoTestScalarTypes,
      temporal: {
        CreatedAt: {
          kind: 'typeAlias',
          output: { type: { codecId: 'mongo/date@1' }, onCreate: { name: 'now', args: {} } },
        },
        UpdatedAt: {
          kind: 'typeAlias',
          output: {
            type: { codecId: 'mongo/date@1' },
            onCreate: { name: 'now', args: {} },
            onUpdate: { name: 'now', args: {} },
          },
        },
      },
    },
  },
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

const { field, type } = createContractAuthoringHelpers({
  family: mongoFamilyPack,
  target: generatingTargetPack,
  extensions: { choices: choicePack },
});

describe('the MongoDB type helpers', () => {
  it.each([
    ['ObjectId', 'mongo/objectId@1'],
    ['String', 'mongo/string@1'],
    ['Double', 'mongo/double@1'],
    ['Int32', 'mongo/int32@1'],
    ['Bool', 'mongo/bool@1'],
    ['DateTime', 'mongo/date@1'],
    ['Int64', 'mongo/int64@1'],
    ['Int64Number', 'mongo/int64Number@1'],
    ['Decimal128', 'mongo/decimal128@1'],
    ['Binary', 'mongo/binary@1'],
    ['Json', 'mongo/json@1'],
    ['Bson', 'mongo/bson@1'],
    ['Vector', 'mongo/vector@1'],
  ] as const)(
    'type the field of type.%s() with its codec and no type parameters',
    (name, codecId) => {
      expect(field.scalar(type[name]()).__type).toStrictEqual({ kind: 'scalar', codecId });
    },
  );

  it('leave out a constructor PSL keeps only as a deprecated name', () => {
    expect(['Int', 'Float', 'Boolean', 'Int32'].filter((name) => name in type)).toEqual(['Int32']);
  });

  it('give a vector its length as a type parameter', () => {
    expect(field.scalar(type.Vector(3)).__type).toStrictEqual({
      kind: 'scalar',
      codecId: 'mongo/vector@1',
      typeParams: { length: 3 },
    });
  });

  it('refuse an argument its data type does not read', () => {
    expect(() => Reflect.apply(type.Vector, type, ['three'])).toThrow(
      expect.objectContaining({ code: 'CONTRACT.ARGUMENT_INVALID' }),
    );
  });

  it('give each field a type alias types the generator calls of the alias', () => {
    const contract = defineContract(
      { family: mongoFamilyPack, target: generatingTargetPack },
      ({ field: f, model, type: t }) => ({
        models: {
          Post: model('Post', {
            collection: 'posts',
            fields: {
              _id: f.scalar(t.ObjectId()),
              createdAt: f.scalar(t.temporal.CreatedAt()),
              updatedAt: f.scalar(t.temporal.UpdatedAt()),
            },
          }),
        },
      }),
    );
    const timestampNow = { kind: 'generator', id: 'timestampNow' };
    const ref = (fieldName: string) => ({
      namespace: UNBOUND_NAMESPACE_ID,
      entry: 'posts',
      field: fieldName,
    });
    expect(contract.execution?.mutations.defaults).toEqual([
      { ref: ref('createdAt'), onCreate: timestampNow },
      { ref: ref('updatedAt'), onCreate: timestampNow, onUpdate: timestampNow },
    ]);
  });

  it('refuse a phase a type alias already sets', () => {
    expect(() =>
      field.scalar(type.temporal.CreatedAt()).onCreate({ name: 'now', args: {} }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: { reason: 'generator-phase-set-twice', phase: 'onCreate' },
      }),
    );
  });

  it("put an extension pack's constructors under its namespace", () => {
    expect([
      field.scalar(type.choices.Text()).__type,
      field.scalar(type.choices.Embedding(4)).__type,
    ]).toStrictEqual([
      { kind: 'scalar', codecId: 'mongo/string@1' },
      { kind: 'scalar', codecId: 'mongo/vector@1', typeParams: { length: 4 } },
    ]);
  });

  it('give a type choice the type of the row its options choose', () => {
    expect([
      type.choices.Value(),
      type.choices.Value({ as: 'text' }),
      type.choices.Value({ as: 'vector', length: 2 }),
    ]).toStrictEqual([
      { kind: 'scalar', codecId: 'mongo/string@1' },
      { kind: 'scalar', codecId: 'mongo/string@1' },
      { kind: 'scalar', codecId: 'mongo/vector@1', typeParams: { length: 2 } },
    ]);
  });

  it('refuse an entity type named like a built-in helper, type included', () => {
    const family = {
      ...mongoFamilyPack,
      authoring: {
        entityTypes: {
          type: { kind: 'entity', discriminator: 'type', output: { factory: () => ({}) } },
        },
      },
    } as const;
    expect(() => createContractAuthoringHelpers({ family, target: mongoTargetPack })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        meta: { reason: 'reserved-helper-key-collision', contribution: ['type'] },
      }),
    );
  });
});
