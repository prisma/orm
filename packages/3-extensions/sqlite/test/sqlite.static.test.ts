import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import sqliteStatic from '../src/static/sqlite-static';

const contract: Contract<SqlStorage> = {
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: profileHash('sqlite-static-test'),
  domain: applicationDomainOf({ models: {} }),
  roots: {},
  storage: new SqlStorage({
    storageHash: coreHash('sqlite-static-test'),
    namespaces: {
      __unbound__: sqliteCreateNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  }),
  extensions: {},
  capabilities: {},
  meta: {},
};

describe('sqliteStatic({ contract })', () => {
  it('context carries the contract (merged capabilities view)', () => {
    const result = sqliteStatic({ contract });
    expect(result.context.contract).toBeDefined();
    expect(result.context.contract.target).toBe(contract.target);
  });

  it('contract matches the validated contract', () => {
    const result = sqliteStatic({ contract });
    expect(result.contract.target).toBe(contract.target);
    expect(result.contract.targetFamily).toBe(contract.targetFamily);
    expect(result.contract.domain).toEqual(contract.domain);
    expect(result.contract.profileHash).toBe(contract.profileHash);
  });
});
