import { expectTypeOf, test } from 'vitest';
import { SqliteMigration } from '../src/core/migrations/sqlite-migration';
import type { SqliteContractView } from '../src/core/sqlite-contract-view';
import type { Contract } from './fixtures/sqlite-contract.d';

/**
 * Emit-then-consume type tests: the migration's `endContract` getter resolves
 * to the precisely-typed `SqliteContractView<End>` over the real emitted SQLite
 * contract fixture.
 */

class TypedMigration extends SqliteMigration<Contract, Contract> {
  override readonly endContractJson = {} as Contract;
  override get operations() {
    return [];
  }
}

type EndView = TypedMigration['endContract'];
type StartView = TypedMigration['startContract'];

test('endContract is a SqliteContractView<Contract>', () => {
  expectTypeOf<EndView>().toEqualTypeOf<SqliteContractView<Contract>>();
});

test('startContract is SqliteContractView<Contract> | null', () => {
  expectTypeOf<StartView>().toEqualTypeOf<SqliteContractView<Contract> | null>();
});
