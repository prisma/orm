import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { MongoQueryExecutor } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import { mongoOrm } from '../src/mongo-orm';
import { contextOf } from './collection-context';

const runtime: MongoQueryExecutor = {
  query: () => new AsyncIterableResult((async function* () {})()),
  execute: async () => ({ affectedRows: 0 }),
};

describe('the Mongo ORM client of a contract.json with a root named __proto__', () => {
  it('holds that root as an own key and keeps a plain prototype', () => {
    const loaded = JSON.parse(
      JSON.stringify(ormContractJson).replace(
        '"roots":{',
        '"roots":{"__proto__":{"model":"User","namespace":"__unbound__"},',
      ),
    ) as Contract;
    const client = mongoOrm({ context: contextOf(loaded), runtime });
    expect({
      prototypeIsPlain: Object.getPrototypeOf(client) === Object.prototype,
      ownProto: Object.hasOwn(client, '__proto__'),
      roots: Object.keys(client).length,
    }).toEqual({
      prototypeIsPlain: true,
      ownProto: true,
      roots: Object.keys(loaded.roots).length,
    });
  });
});
