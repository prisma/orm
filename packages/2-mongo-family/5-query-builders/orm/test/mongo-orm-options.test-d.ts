import type { MongoExecutionContext } from '@internal/mongo-query-ast/execution';
import { test } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import type { MongoOrmEnums } from '../src/collection';
import { createMongoCollection } from '../src/collection';
import type { MongoQueryExecutor } from '../src/executor';
import { mongoOrm } from '../src/mongo-orm';
import { mongoRaw } from '../src/mongo-raw';

declare const contract: Contract;
declare const context: MongoExecutionContext<Contract>;
declare const executor: MongoQueryExecutor;
declare const enums: MongoOrmEnums;

test("mongoOrm() and createMongoCollection() require the contract's enum accessors", () => {
  // @ts-expect-error a written enum value is checked against the contract's enum accessors
  mongoOrm({ context, executor });
  // @ts-expect-error a written enum value is checked against the contract's enum accessors
  createMongoCollection(contract, 'User', executor);
});

test('mongoOrm() and mongoRaw() take an execution context, not a contract', () => {
  mongoOrm({ context, executor, enums });
  mongoRaw({ context });
  // @ts-expect-error a contract alone is not accepted; build the context with mongoStatic() or mongo()
  mongoOrm({ contract, executor, enums });
  // @ts-expect-error a contract alone is not accepted; build the context with mongoStatic() or mongo()
  mongoRaw({ contract });
});
