import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import type { AdapterProfile } from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import { SqlFamilyAdapter } from '../src/sql-family-adapter';
import { stubAst } from './utils';

// Minimal test contract
const testContract: Contract<SqlStorage> = {
  targetFamily: 'sql',
  target: 'postgres',
  profileHash: profileHash('test-hash'),
  domain: applicationDomainOf({ models: {} }),
  roots: {},
  storage: new SqlStorage({
    storageHash: coreHash('test-hash'),
    namespaces: {
      __unbound__: createTestSqlNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  }),
  extensions: {},
  capabilities: {},
  meta: {},
};

const testProfile: AdapterProfile = {
  id: 'test/default@1',
  target: 'postgres',
  capabilities: {},
  readMarker: async () => ({ kind: 'absent' }),
};

describe('SqlFamilyAdapter', () => {
  it('delegates readMarker to adapter profile', async () => {
    const adapter = new SqlFamilyAdapter(testContract, testProfile);
    const fakeQueryable = {
      execute: async () => ({ affectedRows: 0 }),
      async *query() {},
    };
    const result = await adapter.markerReader.readMarker(fakeQueryable);

    expect(result).toEqual({ kind: 'absent' });
  });

  it('validates plan with matching target and hash', () => {
    const adapter = new SqlFamilyAdapter(testContract, testProfile);
    const plan: SqlExecutionPlan = {
      meta: {
        target: 'postgres',
        storageHash: 'test-hash',
        lane: 'sql',
      },
      sql: 'SELECT 1',
      params: [],
      ast: stubAst(),
    };

    // Should not throw
    expect(() => adapter.validatePlan(plan, testContract)).not.toThrow();
  });

  it('throws on plan target mismatch', () => {
    const adapter = new SqlFamilyAdapter(testContract, testProfile);
    const plan: SqlExecutionPlan = {
      meta: {
        target: 'mysql', // Wrong target
        storageHash: 'test-hash',
        lane: 'sql',
      },
      sql: 'SELECT 1',
      params: [],
      ast: stubAst(),
    };

    expect(() => adapter.validatePlan(plan, testContract)).toThrow(
      expect.objectContaining({
        message: 'The plan was built for another target than the contract',
        details: { planTarget: 'mysql', contractTarget: testContract.target },
      }),
    );
  });

  it('throws on plan storageHash mismatch', () => {
    const adapter = new SqlFamilyAdapter(testContract, testProfile);
    const plan: SqlExecutionPlan = {
      meta: {
        target: 'postgres',
        storageHash: 'different-hash', // Wrong hash
        lane: 'sql',
      },
      sql: 'SELECT 1',
      params: [],
      ast: stubAst(),
    };

    expect(() => adapter.validatePlan(plan, testContract)).toThrow(
      expect.objectContaining({
        message: 'The plan was built for another contract',
        details: {
          planStorageHash: 'different-hash',
          contractStorageHash: testContract.storage.storageHash,
        },
      }),
    );
  });
});
