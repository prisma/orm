import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../../../2-mongo-family/1-foundation/mongo-contract/test/fixtures/orm-contract';
import contractJson from '../../../2-mongo-family/1-foundation/mongo-contract/test/fixtures/orm-contract.json' with {
  type: 'json',
};
import mongo, { type MongoClient } from '../src/exports/runtime';
import mongoStatic, { contractFromJson, type MongoStaticContext } from '../src/exports/static';

const contract = contractFromJson<Contract>(contractJson);

test('contractFromJson returns the named contract type', () => {
  expectTypeOf(contract).toEqualTypeOf<Contract>();
});

test('contractFromJson takes only a Mongo contract type', () => {
  // @ts-expect-error a type that is not a Mongo contract
  contractFromJson<{ readonly target: 'mongo' }>(contractJson);
});

test('each client infers the contract type from the value', () => {
  expectTypeOf(mongo({ contract })).toEqualTypeOf<MongoClient<Contract>>();
  expectTypeOf(mongoStatic({ contract })).toEqualTypeOf<MongoStaticContext<Contract>>();
  expectTypeOf(mongo({ contract }).orm.users).toHaveProperty('all');
});

test('no client takes contractJson', () => {
  // @ts-expect-error the contract is passed as a value
  mongo<Contract>({ contractJson });
  // @ts-expect-error the contract is passed as a value
  mongoStatic({ contractJson });
});
