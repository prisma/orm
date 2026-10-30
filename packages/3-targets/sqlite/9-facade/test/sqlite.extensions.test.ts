import { coreHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import type { SqlRuntimeExtensionDescriptor } from '@internal/sql-runtime';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import sqlite from '../src/runtime/sqlite';

function unboundSqlStorage(): SqlStorage {
  return new SqlStorage({
    storageHash: coreHash('sqlite-extensions-test'),
    namespaces: {
      __unbound__: sqliteCreateNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  });
}

function createTestExtensionPack(id: string): SqlRuntimeExtensionDescriptor<'sqlite'> {
  return {
    kind: 'extension',
    id,
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'sqlite',
    capabilities: {
      sqlite: {
        [id]: true,
      },
    },
    codecs: () => [],
    create() {
      return { familyId: 'sql', targetId: 'sqlite' };
    },
  };
}

describe('sqlite extensions', () => {
  it('builds db.context with a contract-required extension pack instead of throwing', () => {
    const extensionPackId = 'test-pack';
    const pack = createTestExtensionPack(extensionPackId);
    const contract = createContract<SqlStorage>({
      target: 'sqlite',
      storage: unboundSqlStorage(),
      extensions: {
        [extensionPackId]: { id: extensionPackId, version: '0.0.1' },
      },
    });

    const db = sqlite({
      contract,
      path: ':memory:',
      extensions: [pack],
    });

    expect(db.context.contract.capabilities['sqlite']?.[extensionPackId]).toBe(true);
  });

  it('throws when the contract requires an extension pack that is not provided', () => {
    const extensionPackId = 'test-pack';
    const contract = createContract<SqlStorage>({
      target: 'sqlite',
      storage: unboundSqlStorage(),
      extensions: {
        [extensionPackId]: { id: extensionPackId, version: '0.0.1' },
      },
    });

    expect(() =>
      sqlite({
        contract,
        path: ':memory:',
      }),
    ).toThrow(/MISSING_EXTENSION_PACK|extension pack/i);
  });
});
