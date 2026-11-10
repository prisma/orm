import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlRuntimeExtensionDescriptor } from '@internal/sql-runtime';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import postgres from '../src/runtime/postgres';

function createTestExtensionPack(id: string): SqlRuntimeExtensionDescriptor<'postgres'> {
  return {
    kind: 'extension',
    id,
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    capabilities: {
      postgres: {
        [id]: true,
      },
    },
    codecs: () => [],
    create() {
      return { familyId: 'sql', targetId: 'postgres' };
    },
  };
}

describe('postgres extensions', () => {
  it('builds db.context with a contract-required extension pack instead of throwing', () => {
    const extensionPackId = 'test-pack';
    const pack = createTestExtensionPack(extensionPackId);
    const contract = createContract<SqlStorage>({
      extensions: {
        [extensionPackId]: { id: extensionPackId, version: '0.0.1' },
      },
    });

    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
      extensions: [pack],
    });

    expect(db.context.contract.capabilities['postgres']?.[extensionPackId]).toBe(true);
  });

  it('throws when the contract requires an extension pack that is not provided', () => {
    const extensionPackId = 'test-pack';
    const contract = createContract<SqlStorage>({
      extensions: {
        [extensionPackId]: { id: extensionPackId, version: '0.0.1' },
      },
    });

    expect(() =>
      postgres({
        contract,
        url: 'postgres://localhost:5432/db',
      }),
    ).toThrow(/MISSING_EXTENSION_PACK|extension pack/i);
  });
});
