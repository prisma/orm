import { expectTypeOf, test } from 'vitest';
import { prismaAdapter } from '../../src/exports/index';
import type { SqlContract } from '../../src/models/model-lookup';

declare const contract: SqlContract;
const withoutTransactions = { contract, orm: {} };
const withTransactions = {
  contract,
  orm: {},
  transaction<R>(fn: (tx: { readonly orm: object }) => PromiseLike<R>): Promise<R> {
    return Promise.resolve(fn({ orm: {} }));
  },
};

test('a client without transaction() is accepted while the transaction option is off', () => {
  expectTypeOf(prismaAdapter(withoutTransactions)).toBeFunction();
  expectTypeOf(prismaAdapter(withoutTransactions, {})).toBeFunction();
  expectTypeOf(prismaAdapter(withoutTransactions, { transaction: false })).toBeFunction();
  expectTypeOf(prismaAdapter(withoutTransactions, { usePlural: true })).toBeFunction();
});

test('the transaction option needs a client with transaction()', () => {
  // @ts-expect-error transaction: true runs Better Auth's transactions through db.transaction()
  prismaAdapter(withoutTransactions, { transaction: true });
  const maybe: boolean = Math.random() > 0.5;
  // @ts-expect-error the option may be on
  prismaAdapter(withoutTransactions, { transaction: maybe });
  expectTypeOf(prismaAdapter(withTransactions, { transaction: true })).toBeFunction();
});
