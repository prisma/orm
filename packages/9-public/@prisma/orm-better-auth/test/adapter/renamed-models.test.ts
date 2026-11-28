import type { BetterAuthOptions } from '@better-auth/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaAdapter } from '../../src/exports/index';
import {
  type AdapterDatabases,
  createAdapterDatabases,
  type TestClient,
} from '../helpers/adapter-databases';
import { targets } from '../helpers/databases';
import { pslForConfiguration } from '../helpers/printed-psl';
import { timeouts } from '../timeouts';

let databases: AdapterDatabases;

beforeAll(async () => {
  databases = await createAdapterDatabases();
}, timeouts.devServerStart);

afterAll(() => databases?.dispose(), timeouts.devServerClose + timeouts.hook);

const swappedNames: BetterAuthOptions = {
  user: { modelName: 'account', fields: { email: 'emailAddress' } },
  account: { modelName: 'credential' },
};

describe.each(targets)('a model renamed to another model’s key on %s', (target) => {
  let client: TestClient;
  const adapter = () => prismaAdapter(client)(swappedNames);
  const now = new Date('2026-01-01T00:00:00.000Z');

  beforeAll(async () => {
    client = await databases.open(
      target,
      pslForConfiguration(databases.emptyContract(target), swappedNames),
    );
    for (const [id, email] of [
      ['u2', 'b@example.com'],
      ['u1', 'a@example.com'],
    ]) {
      await adapter().create({
        model: 'user',
        data: { id, name: id, email, emailVerified: false, createdAt: now, updatedAt: now },
        forceAllowId: true,
      });
    }
  }, timeouts.hook);

  it('reads selected fields by Better Auth’s field names', async () => {
    expect(
      await adapter().findOne({
        model: 'user',
        where: [{ field: 'id', value: 'u1' }],
        select: ['email'],
      }),
    ).toEqual({ email: 'a@example.com' });
  });

  it('sorts by a Better Auth field name', async () => {
    const users = await adapter().findMany<{ id: string }>({
      model: 'user',
      sortBy: { field: 'email', direction: 'asc' },
    });
    expect(users.map((user) => user.id)).toEqual(['u1', 'u2']);
  });
});

const caseOnlyDifferentNames: BetterAuthOptions = {
  plugins: [
    {
      id: 'upper-user',
      schema: { upperUser: { modelName: 'User', fields: { note: { type: 'string' } } } },
    },
  ],
};

describe.each(targets)(
  'two models whose names differ only in first-letter case on %s',
  (target) => {
    let client: TestClient;

    beforeAll(async () => {
      client = await databases.open(
        target,
        pslForConfiguration(databases.emptyContract(target), {}),
      );
    }, timeouts.hook);

    it('every call is refused with the schema mismatch error that names both', async () => {
      const adapter = prismaAdapter(client)(caseOnlyDifferentNames);
      for (const model of ['user', 'User']) {
        await expect(
          adapter.findOne({ model, where: [{ field: 'id', value: 'u1' }] }),
        ).rejects.toMatchObject({
          name: 'BetterAuthError',
          code: 'SCHEMA_MISMATCH',
          message: expect.stringContaining('"user" and "User"'),
        });
      }
    });
  },
);
