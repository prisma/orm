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
import { mongoTestScalarTypes } from './mongo-test-packs';

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
  authoring: { type: mongoTestScalarTypes },
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
  defineContract({ family: mongoFamilyPack, target: mongoTargetPack }, ({ field, gen, type }) => {
    field.scalar(type.DateTime()).onCreate(gen.now()).optional();
    // @ts-expect-error onCreate and onUpdate fill the field, so it cannot be a list
    field.scalar(type.DateTime()).onCreate(gen.now()).onUpdate(gen.now()).many();
    field.scalar(type.DateTime()).onUpdate(gen.now()).optional();
    field.scalar(type.DateTime()).optional();
    field.scalar(type.String()).optional().many();
    return { models: {} };
  });
});

test('the type error for many() on a field that generates a value says why', () => {
  defineContract({ family: mongoFamilyPack, target: mongoTargetPack }, ({ field, gen, type }) => {
    const createdAt = field.scalar(type.DateTime()).onCreate(gen.now());
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
  defineContract({ family: mongoFamilyPack, target: mongoTargetPack }, ({ field, gen, type }) => {
    expectTypeOf(field.scalar(type.DateTime()).onCreate(gen.now())).toExtend<WideFieldBuilder>();
    expectTypeOf(field.scalar(type.String()).optional()).toExtend<WideFieldBuilder>();
    return { models: {} };
  });
});

test('the built contract types its execution defaults with the collection and field names', () => {
  const contract = defineContract(
    { family: mongoFamilyPack, target: mongoTargetPack },
    ({ field, model, gen, type }) => ({
      models: {
        Post: model('Post', {
          collection: 'posts',
          fields: {
            _id: field.scalar(type.ObjectId()),
            title: field.scalar(type.String()),
            createdAt: field.scalar(type.DateTime()).onCreate(gen.now()),
            touchedAt: field.scalar(type.DateTime()).onUpdate(gen.now()),
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
    ({ field, model, gen, type }) => ({
      models: {
        Post: model('Post', {
          collection: 'posts',
          fields: {
            id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
            createdAt: field
              .scalar(type.DateTime())
              .onCreate(gen.now())
              .mongo({ field: 'created_at' }),
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
