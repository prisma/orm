import type {
  ContractFieldType,
  ExecutionMutationDefaultPhases,
  ExecutionMutationDefaultValue,
} from '@internal/contract/types';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { singleGeneratorBinding } from '@internal/framework-components/components';
import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../src/contract-builder';
import type { FieldBuilder } from '../src/contract-dsl';
import type { EnumTypeHandle } from '../src/enum-type';

const mongoFamilyPack = {
  kind: 'family',
  id: 'mongo',
  familyId: 'mongo',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'mongo'>;

const mongoTargetPack = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
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

test('a field a generator fills can be optional but not a list', () => {
  defineContract({ family: mongoFamilyPack, target: mongoTargetPack }, ({ field, gen }) => {
    field.date().onCreate(gen.now()).optional();
    // @ts-expect-error onCreate and onUpdate fill the field, so it cannot be a list
    field.date().onCreate(gen.now()).onUpdate(gen.now()).many();
    field.date().onUpdate(gen.now()).optional();
    field.date().optional();
    field.string().optional().many();
    return { models: {} };
  });
});

test('the type error for many() on a field that generates a value says why', () => {
  defineContract({ family: mongoFamilyPack, target: mongoTargetPack }, ({ field, gen }) => {
    const createdAt = field.date().onCreate(gen.now());
    expectTypeOf<
      ThisParameterType<typeof createdAt.many>
    >().toEqualTypeOf<'This field generates a value on write, so it cannot be a list'>();
    return { models: {} };
  });
});

test('a generated field still satisfies the widest FieldBuilder constraint', () => {
  type WideFieldBuilder = FieldBuilder<
    ContractFieldType,
    boolean,
    false | { readonly elementNullable: boolean },
    EnumTypeHandle | undefined,
    ExecutionMutationDefaultPhases | undefined
  >;
  defineContract({ family: mongoFamilyPack, target: mongoTargetPack }, ({ field, gen }) => {
    expectTypeOf(field.date().onCreate(gen.now())).toExtend<WideFieldBuilder>();
    expectTypeOf(field.string().optional()).toExtend<WideFieldBuilder>();
    return { models: {} };
  });
});

test('the built contract types its execution defaults with the collection and field names', () => {
  const contract = defineContract(
    { family: mongoFamilyPack, target: mongoTargetPack },
    ({ field, model, gen }) => ({
      models: {
        Post: model('Post', {
          collection: 'posts',
          fields: {
            _id: field.objectId(),
            title: field.string(),
            createdAt: field.date().onCreate(gen.now()),
            touchedAt: field.date().onUpdate(gen.now()),
          },
        }),
      },
    }),
  );
  type Defaults = NonNullable<(typeof contract)['execution']>['mutations']['defaults'][number];
  expectTypeOf<Defaults>().toEqualTypeOf<
    | {
        readonly ref: {
          readonly namespace: '__unbound__';
          readonly entry: 'posts';
          readonly field: 'createdAt';
        };
        readonly onCreate: ExecutionMutationDefaultValue;
      }
    | {
        readonly ref: {
          readonly namespace: '__unbound__';
          readonly entry: 'posts';
          readonly field: 'touchedAt';
        };
        readonly onUpdate: ExecutionMutationDefaultValue;
      }
  >();
});

test('the built contract types an execution default ref with the stored name of its field', () => {
  const contract = defineContract(
    { family: mongoFamilyPack, target: mongoTargetPack },
    ({ field, model, gen }) => ({
      models: {
        Post: model('Post', {
          collection: 'posts',
          fields: {
            id: field.objectId().mongo({ field: '_id' }),
            createdAt: field.date().onCreate(gen.now()).mongo({ field: 'created_at' }),
          },
        }),
      },
    }),
  );
  type Defaults = NonNullable<(typeof contract)['execution']>['mutations']['defaults'][number];
  expectTypeOf<Defaults>().toEqualTypeOf<{
    readonly ref: {
      readonly namespace: '__unbound__';
      readonly entry: 'posts';
      readonly field: 'created_at';
    };
    readonly onCreate: ExecutionMutationDefaultValue;
  }>();
});
