import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { MongoQueryExecutor, MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import { createMongoCollection } from '../src/collection';
import { collectionContext } from './collection-context';

const contract = ormContractJson as unknown as Contract;

function recordingExecutor(): MongoQueryExecutor & { readonly plans: MongoQueryPlan[] } {
  const plans: MongoQueryPlan[] = [];
  return {
    plans,
    query<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row> {
      plans.push(plan as MongoQueryPlan);
      return new AsyncIterableResult((async function* () {})());
    },
    async execute(plan: MongoQueryPlan) {
      plans.push(plan);
      return { affectedRows: 1 };
    },
  };
}

describe('value object data keyed by names every object has', () => {
  it('passes them through as own keys of the stored value object', async () => {
    const executor = recordingExecutor();
    const users = createMongoCollection(collectionContext(contract, executor), 'User');
    const homeAddress = Object.fromEntries([
      ['city', 'NYC'],
      ['country', 'US'],
      ['constructor', 'x'],
      ['__proto__', 'y'],
    ]);
    await users
      .create({
        name: 'Alice',
        email: 'a@b.c',
        loginCount: 0,
        tags: [],
        homeAddress: homeAddress as never,
      })
      .catch(() => undefined);
    const command = executor.plans[0]?.command;
    const stored =
      command?.kind === 'insertOne' ? (command.document['homeAddress'] as object) : undefined;
    expect({
      keys: Object.keys(stored ?? {}),
      prototypeIsPlain: Object.getPrototypeOf(stored) === Object.prototype,
    }).toEqual({ keys: ['city', 'country', 'constructor', '__proto__'], prototypeIsPlain: true });
  });

  it('refuses a top-level __proto__ key as an unknown field rather than dropping it', async () => {
    const users = createMongoCollection(collectionContext(contract, recordingExecutor()), 'User');
    const data = Object.fromEntries([
      ['name', 'Alice'],
      ['email', 'a@b.c'],
      ['loginCount', 0],
      ['tags', []],
      ['homeAddress', null],
      ['__proto__', 'y'],
    ]);
    const error = await users.create(data as never).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'ORM.FIELD_UNKNOWN' });
  });
});
