import { test } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import { createMongoCollection } from '../src/collection';
import type { MongoQueryExecutor } from '../src/executor';
import { mongoOrm } from '../src/mongo-orm';

declare const contract: Contract;
declare const executor: MongoQueryExecutor;

test('mongoOrm() and createMongoCollection() require the runtime codecs', () => {
  // @ts-expect-error a written enum value is checked through the runtime's codecs
  mongoOrm({ contract, executor });
  // @ts-expect-error a written enum value is checked through the runtime's codecs
  createMongoCollection(contract, 'User', executor);
});
