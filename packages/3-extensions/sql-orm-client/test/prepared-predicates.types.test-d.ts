import type {
  ContractWithTypeMaps,
  ExtractCodecTypes,
  TypeMapsPhantomKey,
} from '@internal/sql-contract/types';
import type { Expression } from '@internal/sql-relational-core/expression';
import type { BindSiteParams } from '@internal/sql-runtime';
import { expectTypeOf, test } from 'vitest';
import type { ModelAccessor, ShorthandWhereFilter } from '../src/types';
import { createCollectionFor } from './collection-fixtures';
import type { TestContract } from './helpers';

declare const params: BindSiteParams<{
  id: 'pg/int4@1';
  email: 'pg/text@1';
  optional: { codecId: 'pg/int4@1'; nullable: true };
}>;
declare const many: Expression<{ codecId: 'pg/int4@1'; nullable: false; many: true }>;

test('prepared predicate positions preserve codec identity, scalar shape, nullability and traits', () => {
  const { collection } = createCollectionFor('User');
  collection.where({ id: params.id, email: params.email, invitedById: params.id });
  collection.where((user) => user.id.eq(params.id));
  collection.where((user) => user.invitedById.neq(params.id));
  collection.where((user) => user.id.gte(params.id));
  collection.where((user) => user.email.like(params.email));
  collection.where((user) => user.id.in([params.id, 1, params.id]));
  collection.where((user) => user.id.notIn([2, params.id]));
  collection.where((user) => user.posts.some((post) => post.id.eq(params.id)));
  collection.where((user) => user.posts.some({ id: params.id }));
  collection.select('id').prepared.first({ id: params.id });
  collection.select('id').prepared.first((user) => user.id.eq(params.id));
  // @ts-expect-error different codec identity
  collection.where({ id: params.email });
  // @ts-expect-error different codec identity
  collection.where((user) => user.id.eq(params.email));
  // @ts-expect-error nullable prepared comparisons are not supported
  collection.where({ invitedById: params.optional });
  // @ts-expect-error column nullability does not admit nullable parameters
  collection.where((user) => user.invitedById.eq(params.optional));
  // @ts-expect-error nullable list member
  collection.where((user) => user.id.in([params.id, params.optional]));
  // @ts-expect-error wrong codec in a fixed list
  collection.where((user) => user.id.notIn([params.email]));
  // @ts-expect-error no dynamic list expression
  collection.where((user) => user.id.in(many));
  // @ts-expect-error list expressions cannot stand in for individual scalar operands
  collection.where((user) => user.id.eq(many));
  // @ts-expect-error numeric fields have no textual trait
  collection.where((user) => user.id.like(params.email));
  // @ts-expect-error wrong terminal-filter codec
  collection.select('id').prepared.first({ id: params.email });
});

type InputContract = ContractWithTypeMaps<
  Omit<TestContract, TypeMapsPhantomKey>,
  {
    codecTypes: Omit<ExtractCodecTypes<TestContract>, 'pg/int4@1'> & {
      'pg/int4@1': {
        input: number | `${number}`;
        output: number;
        traits: 'equality' | 'order' | 'numeric';
      };
    };
  }
>;

type NoEqualityContract = ContractWithTypeMaps<
  Omit<TestContract, TypeMapsPhantomKey>,
  {
    codecTypes: Omit<ExtractCodecTypes<TestContract>, 'pg/int4@1'> & {
      'pg/int4@1': { input: number; output: number; traits: 'numeric' };
    };
  }
>;

test('prepared shorthand does not add equality to an untraited codec', () => {
  expectTypeOf<typeof params.id>().not.toExtend<
    ShorthandWhereFilter<NoEqualityContract, 'public', 'User'>['id']
  >();
  expectTypeOf<ModelAccessor<NoEqualityContract, 'User'>['id']['eq']>().toBeNever();
});

type RefinedInputContract = ContractWithTypeMaps<
  Omit<TestContract, TypeMapsPhantomKey>,
  {
    codecTypes: ExtractCodecTypes<TestContract>;
    fieldInputTypes: { public: { User: { id: `${number}` } } };
  }
>;

test('predicate literals honor emitted field input refinements', () => {
  expectTypeOf<'42'>().toExtend<
    Parameters<ModelAccessor<RefinedInputContract, 'User'>['id']['eq']>[0]
  >();
  expectTypeOf<{ id: '42' }>().toExtend<
    ShorthandWhereFilter<RefinedInputContract, 'public', 'User'>
  >();
  expectTypeOf<number>().not.toExtend<
    Parameters<ModelAccessor<RefinedInputContract, 'User'>['id']['eq']>[0]
  >();
});

test('predicate literals use codec inputs instead of decoded output types', () => {
  expectTypeOf<'42'>().toExtend<Parameters<ModelAccessor<InputContract, 'User'>['id']['eq']>[0]>();
  expectTypeOf<{ id: '42' }>().toExtend<ShorthandWhereFilter<InputContract, 'public', 'User'>>();
  expectTypeOf<boolean>().not.toExtend<
    Parameters<ModelAccessor<InputContract, 'User'>['id']['eq']>[0]
  >();
});
