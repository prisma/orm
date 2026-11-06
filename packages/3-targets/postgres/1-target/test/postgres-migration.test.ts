import type { MigrationToolsError } from '@internal/migration-tools/errors';
import { describe, expect, it } from 'vitest';
import { PostgresMigration } from '../src/core/migrations/postgres-migration';
import type { Contract } from './fixtures/namespaced-contract.d';
import contractJson from './fixtures/namespaced-contract.json' with { type: 'json' };

const END_HASH = contractJson.storage.storageHash;

class TestMigration extends PostgresMigration<Contract, Contract> {
  override readonly endContractJson = contractJson;
  override get operations() {
    return [];
  }
}

class WithStartMigration extends PostgresMigration<Contract, Contract> {
  override readonly startContractJson = contractJson;
  override readonly endContractJson = contractJson;
  override get operations() {
    return [];
  }
}

describe('PostgresMigration view getters', () => {
  it('this.endContract is a typed schema-qualified PostgresContractView', () => {
    const view = new TestMigration().endContract;
    expect(view.namespace.public.table.users).toBeDefined();
    expect(view.namespace.auth.table.users).toBeDefined();
    // Substitutable for Contract: the full envelope is present.
    expect(view.storage.storageHash).toBe(END_HASH);
  });

  it('this.endContract reads per-schema table data through the view', () => {
    const view = new TestMigration().endContract;
    expect(Object.keys(view.namespace.public.table.users.columns).sort()).toEqual(['email', 'id']);
    expect(Object.keys(view.namespace.auth.table.users.columns).sort()).toEqual(['id', 'token']);
  });

  it('this.startContract is null when no startContractJson is provided (baseline)', () => {
    expect(new TestMigration().startContract).toBeNull();
  });

  it('this.startContract is a typed view when startContractJson is provided', () => {
    const view = new WithStartMigration().startContract;
    expect(view).not.toBeNull();
    expect(view?.namespace.public.table.users).toBeDefined();
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
    class NoContract extends PostgresMigration<Contract, Contract> {
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
