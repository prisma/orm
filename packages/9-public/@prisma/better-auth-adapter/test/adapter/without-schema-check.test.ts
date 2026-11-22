import { schemaCheckFor } from '@better-auth/core/db/internal';
import { describe, expect, it, vi } from 'vitest';
import { prismaAdapter } from '../../src/exports/index';
import { useContractFixture } from '../helpers/contract-fixture';
import { applyContract, emitContract, openSqliteClient } from '../helpers/databases';
import { pslForConfiguration } from '../helpers/printed-psl';

vi.mock('@better-auth/core/db/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@better-auth/core/db/internal')>();
  return { ...actual, registerSchemaCheck: undefined };
});

const fixture = useContractFixture();

describe('a Better Auth version without registerSchemaCheck', () => {
  it('loads the adapter, which works without a contract check', async () => {
    const { workDir, emptyContract } = fixture();
    const psl = pslForConfiguration(emptyContract('sqlite'), {});
    const emitted = await emitContract('sqlite', psl, workDir);
    const path = `${workDir.nextPath('database')}.sqlite`;
    await applyContract('sqlite', emitted.json, path, workDir);
    const client = openSqliteClient(emitted.json, path);
    try {
      const adapter = prismaAdapter(client)({});
      expect(schemaCheckFor(adapter)).toBeUndefined();
      await adapter.create({
        model: 'verification',
        data: {
          identifier: 'i',
          value: 'v',
          expiresAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      expect(await adapter.count({ model: 'verification' })).toBe(1);
    } finally {
      await client.close();
    }
  });
});
