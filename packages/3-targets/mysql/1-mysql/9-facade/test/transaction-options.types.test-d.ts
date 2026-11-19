import { expectTypeOf, test } from 'vitest';
import mysql, {
  type MysqlOptionsBase,
  type MysqlTransactionContext,
  type MysqlTransactionOptions,
} from '../src/exports/runtime';
import { contractFromJson } from '../src/exports/static';
import type { Contract } from './fixtures/generated/contract.d';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);

test('global and per-call options support the four MySQL isolation literals', () => {
  expectTypeOf<MysqlTransactionOptions['isolationLevel']>().toEqualTypeOf<
    'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable' | undefined
  >();
  expectTypeOf<MysqlOptionsBase['transactionOptions']>().toEqualTypeOf<
    MysqlTransactionOptions | undefined
  >();
  expectTypeOf<MysqlTransactionOptions['timeout']>().toEqualTypeOf<number | null | undefined>();
  // @ts-expect-error
  expectTypeOf({ timeout: '1000' } satisfies MysqlTransactionOptions);
  const db = mysql({
    contract,
    transactionOptions: { isolationLevel: 'ReadUncommitted', timeout: 1000 },
  });
  expectTypeOf(db.transaction).parameter(1).toEqualTypeOf<MysqlTransactionOptions | undefined>();
  expectTypeOf(
    db.transaction(async () => 42, { isolationLevel: 'Serializable', timeout: null }),
  ).toEqualTypeOf<Promise<number>>();
});

test('rejects null and unsupported isolation literals', () => {
  expectTypeOf<null>().not.toExtend<MysqlTransactionOptions>();
  expectTypeOf<{ isolationLevel: null }>().not.toExtend<MysqlTransactionOptions>();
  expectTypeOf<{ isolationLevel: 'Snapshot' }>().not.toExtend<MysqlTransactionOptions>();
});

test('tx.transaction takes one callback, passes a context of the same type and infers the result', () => {
  type Tx = MysqlTransactionContext<Contract>;
  const tx = {} as Tx;
  expectTypeOf(tx.transaction).parameters.toEqualTypeOf<[(tx: Tx) => PromiseLike<unknown>]>();
  expectTypeOf(tx.transaction).parameter(0).parameter(0).toEqualTypeOf<Tx>();
  expectTypeOf(tx.transaction(async () => 42)).toEqualTypeOf<Promise<number>>();
  expectTypeOf(
    tx.transaction(async (inner) => inner.transaction(async () => 'value' as const)),
  ).toEqualTypeOf<Promise<'value'>>();
});
