import type { Contract as ContractBase } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import { SqliteContractView } from '../src/core/sqlite-contract-view';
import type { Contract } from './fixtures/sqlite-contract.d';

/**
 * Emit-then-consume type tests: `Contract` is the real emitted SQLite contract
 * from `test/fixtures/sqlite-contract.d.ts`. Assertions check the projected
 * view type against the actual emitted shape, not a hand-authored `typeof`.
 */

type CV = SqliteContractView<Contract>;

test('the view is assignable to Contract (superset)', () => {
  expectTypeOf<CV>().toMatchTypeOf<ContractBase>();
});

test('from() and fromJson() both return the view type', () => {
  expectTypeOf(SqliteContractView.from<Contract>).returns.toEqualTypeOf<CV>();
  expectTypeOf(SqliteContractView.fromJson<Contract>).returns.toEqualTypeOf<CV>();
});

test('view.table.<name> resolves to the concrete emitted table leaf', () => {
  expectTypeOf<
    CV['table']['users']['columns']['id']['codecId']
  >().toEqualTypeOf<'sqlite/integer@1'>();
  expectTypeOf<
    CV['table']['users']['columns']['email']['codecId']
  >().toEqualTypeOf<'sqlite/text@1'>();
  expectTypeOf<CV['table']['users']['primaryKey']['columns']>().toEqualTypeOf<readonly ['id']>();
});

test('multiple tables are reachable top-level', () => {
  expectTypeOf<
    CV['table']['posts']['columns']['id']['codecId']
  >().toEqualTypeOf<'sqlite/integer@1'>();
  expectTypeOf<
    CV['table']['comments']['columns']['body']['codecId']
  >().toEqualTypeOf<'sqlite/text@1'>();
});

test('view.namespace.__unbound__ reaches the default namespace by id', () => {
  expectTypeOf<
    CV['namespace']['__unbound__']['table']['users']['columns']['id']['codecId']
  >().toEqualTypeOf<'sqlite/integer@1'>();
});

test('a non-existent table name is a compile error', () => {
  const view = null as unknown as CV;
  // @ts-expect-error 'nonexistent' is not an emitted table
  view.table.nonexistent;
});

test('valueSet slot is present (SQLite emits none, so it is an empty map)', () => {
  expectTypeOf<CV['valueSet']>().toEqualTypeOf<Record<string, never>>();
});

test('view.entries does not contain the built-in table or valueSet keys', () => {
  type Entries = CV['entries'];
  type HasTable = 'table' extends keyof Entries ? true : false;
  type HasValueSet = 'valueSet' extends keyof Entries ? true : false;
  expectTypeOf<HasTable>().toEqualTypeOf<false>();
  expectTypeOf<HasValueSet>().toEqualTypeOf<false>();
});
