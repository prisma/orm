import type { MigrationToolsError } from '@internal/migration-tools/errors';
import { describe, expect, it } from 'vitest';
import { SqliteMigration } from '../src/core/migrations/sqlite-migration';
import type { Contract } from './fixtures/sqlite-contract.d';
import contractJson from './fixtures/sqlite-contract.json' with { type: 'json' };

const END_HASH = contractJson.storage.storageHash;

class TestMigration extends SqliteMigration<Contract, Contract> {
  override readonly endContractJson = contractJson;
  override get operations() {
    return [];
  }
}

class WithStartMigration extends SqliteMigration<Contract, Contract> {
  override readonly startContractJson = contractJson;
  override readonly endContractJson = contractJson;
  override get operations() {
    return [];
  }
}

describe('SqliteMigration view getters', () => {
  it('this.endContract is a typed SqliteContractView built from endContractJson', () => {
    const view = new TestMigration().endContract;
    expect(view.table.users).toBeDefined();
    expect(view.table.posts).toBeDefined();
    // Substitutable for Contract: the full envelope is present.
    expect(view.storage.storageHash).toBe(END_HASH);
  });

  it('this.endContract reads table entity data through the view', () => {
    const view = new TestMigration().endContract;
    expect(view.table.users.columns).toBeDefined();
    // SQLite has no value sets — the slot is an empty map.
    expect(view.valueSet).toEqual({});
  });

  it('this.startContract is null when no startContractJson is provided (baseline)', () => {
    expect(new TestMigration().startContract).toBeNull();
  });

  it('this.startContract is a typed view when startContractJson is provided', () => {
    const view = new WithStartMigration().startContract;
    expect(view).not.toBeNull();
    expect(view?.table.users).toBeDefined();
  });

  it('endContract is memoized (same reference on repeat access)', () => {
    const m = new TestMigration();
    expect(m.endContract).toBe(m.endContract);
  });

  it('startContract is memoized (same reference on repeat access)', () => {
    const m = new WithStartMigration();
    expect(m.startContract).toBe(m.startContract);
  });

  it('describe() is derived from the contract JSON (from:null, to:end hash)', () => {
    expect(new TestMigration().describe()).toEqual({ from: null, to: END_HASH });
    expect(new WithStartMigration().describe()).toEqual({ from: END_HASH, to: END_HASH });
  });

  it('endContract throws when no endContractJson is provided', () => {
    class NoContract extends SqliteMigration<Contract, Contract> {
      override describe() {
        return { from: null, to: 'x' };
      }
      override get operations() {
        return [];
      }
    }
    expect(() => new NoContract().endContract).toThrowError(
      expect.objectContaining({
        code: 'MIGRATION.CONTRACT_VIEW_MISSING',
      }) as unknown as MigrationToolsError,
    );
  });
});
