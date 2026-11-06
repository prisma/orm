import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { MongoQueryExecutor, MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import { MongoPreparedParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import { createMongoCollection } from '../src/collection';
import { collectionContext } from './collection-context';

const contract = ormContractJson as unknown as Contract;

function recordingExecutor() {
  const plans: MongoQueryPlan[] = [];
  const executor: MongoQueryExecutor = {
    query<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row> {
      plans.push(plan as MongoQueryPlan);
      async function* gen(): AsyncGenerator<Row> {
        yield { _id: 'id-1', insertedId: 'id-1' } as Row;
      }
      return new AsyncIterableResult(gen());
    },
    async execute(plan: MongoQueryPlan) {
      plans.push(plan);
      return { affectedRows: 1 };
    },
  };
  return { executor, plans };
}

const placeholder = new MongoPreparedParamRef('value', 'mongo/string@1', false);
const refused = {
  code: 'ORM.ARGUMENT_INVALID',
  meta: { name: 'value', field: expect.any(String) },
};

describe('a prepared placeholder in the Mongo ORM', () => {
  it('is refused in an object-form write, and nothing is sent', async () => {
    const { executor, plans } = recordingExecutor();
    const users = createMongoCollection(collectionContext(contract, executor), 'User');

    await expect(
      users.create({
        name: placeholder as unknown as string,
        email: 'a@b.c',
        loginCount: 0,
        tags: [],
        homeAddress: null,
      }),
    ).rejects.toMatchObject(refused);
    expect(plans).toEqual([]);
  });

  it('is refused in a callback-form update, and nothing is sent', async () => {
    const { executor, plans } = recordingExecutor();
    const users = createMongoCollection(collectionContext(contract, executor), 'User');

    await expect(
      users
        .where({ email: 'a@b.c' })
        .update((u) => [u.tags.push(placeholder as unknown as string)]),
    ).rejects.toMatchObject(refused);
    expect(plans).toEqual([]);
  });

  it('is refused in a value-object literal in a where', async () => {
    const { executor, plans } = recordingExecutor();
    const users = createMongoCollection(collectionContext(contract, executor), 'User');

    await expect(
      (async () =>
        users
          .where({
            homeAddress: { city: placeholder as unknown as string, country: 'FR' },
          })
          .all()
          .toArray())(),
    ).rejects.toMatchObject(refused);
    expect(plans).toEqual([]);
  });
});
