import type { MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import { expectTypeOf } from 'vitest';
import { mongoQuery } from '../src/query';
import type { ModelNestedShape } from '../src/resolve-path';
import type { ModelToDocShape } from '../src/types';
import { contextOf } from './fixtures/test-context';
import { type TestContract, testContract } from './fixtures/test-contract';

type PlanRow<P extends MongoQueryPlan> = P extends MongoQueryPlan<infer R> ? R : never;

type Address = {
  street: string;
  city: string;
  zip: string | null;
  geo: { lat: number; lng: number };
};

type AccountRow = {
  readonly _id: string;
  readonly display_name: string;
  readonly home_address: Address | null;
};

describe('stored names', () => {
  it('keys the document shape by stored name', () => {
    expectTypeOf<keyof ModelToDocShape<TestContract, 'Account'> & string>().toEqualTypeOf<
      '_id' | 'display_name' | 'home_address'
    >();
    expectTypeOf<keyof ModelNestedShape<TestContract, 'Account'>>().toEqualTypeOf<
      '_id' | 'display_name' | 'home_address'
    >();
  });

  it('types each stored name by the field it stores', () => {
    expectTypeOf<ModelToDocShape<TestContract, 'Account'>['_id']>().toEqualTypeOf<{
      readonly codecId: 'mongo/objectId@1';
      readonly nullable: false;
    }>();
  });

  it('exposes _id, not id, on a model whose id field is stored as _id', () => {
    const plan = mongoQuery({ context: contextOf(testContract) })
      .from('accounts')
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<AccountRow>();
  });

  it('accepts stored names and rejects domain field names in match', () => {
    const accounts = mongoQuery({ context: contextOf(testContract) }).from('accounts');
    accounts.match((f) => f._id.eq('a'));
    accounts.match((f) => f('home_address.city').eq('NYC'));
    // @ts-expect-error -- `id` is a domain field name, not a stored name
    accounts.match((f) => f.id.eq('a'));
    // @ts-expect-error -- `displayName` is a domain field name, not a stored name
    accounts.match((f) => f.displayName.eq('a'));
  });

  it('keys a looked-up foreign row by stored name', () => {
    const plan = mongoQuery({ context: contextOf(testContract) })
      .from('orders')
      .lookup((from) =>
        from('accounts')
          .on((local, foreign) => ({ local: local.customerId, foreign: foreign._id }))
          .as('account'),
      )
      .project('account')
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{
      _id: string;
      account: AccountRow[];
    }>();
  });
});
