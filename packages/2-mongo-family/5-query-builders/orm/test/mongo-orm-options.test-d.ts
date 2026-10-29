import type { MongoExecutionContext } from '@internal/mongo-query-ast/execution';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import { createMongoCollection, type MongoEnumAccessors } from '../src/collection';
import type { MongoQueryExecutor } from '../src/executor';
import { mongoOrm } from '../src/mongo-orm';
import { mongoRaw } from '../src/mongo-raw';

declare const contract: Contract;
declare const context: MongoExecutionContext<Contract>;
declare const runtime: MongoQueryExecutor;
declare const enums: MongoEnumAccessors;

test('mongoOrm() takes a context and a runtime, as the SQL orm() does', () => {
  mongoOrm({ context, runtime });
  // @ts-expect-error the enum accessors come from the context
  mongoOrm({ context, runtime, enums });
  // @ts-expect-error the option is named runtime, as in the SQL orm()
  mongoOrm({ context, executor: runtime });
});

test('mongoOrm() and mongoRaw() take an execution context, not a contract', () => {
  mongoRaw({ context });
  // @ts-expect-error a contract alone is not accepted; build the context with mongoStatic() or mongo()
  mongoOrm({ contract, runtime });
  // @ts-expect-error a contract alone is not accepted; build the context with mongoStatic() or mongo()
  mongoRaw({ contract });
});

test('createMongoCollection() takes a context and a runtime, as a SQL Collection does', () => {
  const users = createMongoCollection({ context, runtime }, 'User');
  expectTypeOf(users.create).toBeFunction();
  // @ts-expect-error a contract alone is not accepted; the context carries the mutation defaults
  createMongoCollection(contract, 'User', runtime, enums);
});

test('the execution context is constrained to a Mongo contract, as the SQL ExecutionContext is', () => {
  // @ts-expect-error the contract must be a Mongo contract
  type _NotAContract = MongoExecutionContext<{ readonly anything: true }>;
});
