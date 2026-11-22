import type { BetterAuthOptions } from '@better-auth/core';
import { blindCast } from '@prisma/orm-framework/utils/casts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type PrismaAdapterOptions, prismaAdapter } from '../../src/exports/index';
import {
  type AdapterDatabases,
  createAdapterDatabases,
  probeOptions,
  probePsl,
  type TestClient,
} from '../helpers/adapter-databases';
import { targets } from '../helpers/databases';
import { pslForConfiguration } from '../helpers/printed-psl';
import { recordingClient } from '../helpers/recording-client';
import { timeouts } from '../timeouts';

let databases: AdapterDatabases;

beforeAll(async () => {
  databases = await createAdapterDatabases();
}, timeouts.devServerStart);

afterAll(() => databases?.dispose(), timeouts.devServerClose + timeouts.hook);

const legacyOptions: BetterAuthOptions = {
  ...probeOptions,
  plugins: [
    ...(probeOptions.plugins ?? []),
    {
      id: 'legacy',
      schema: { legacy: { fields: { label: { type: 'string' } }, disableMigration: true } },
    },
  ],
};

describe.each(targets)('calls on %s', (target) => {
  let client: TestClient;
  const adapterOver = (
    db: TestClient,
    options: BetterAuthOptions = probeOptions,
    adapterOptions: PrismaAdapterOptions = {},
  ) => prismaAdapter(db, adapterOptions)(options);

  beforeAll(async () => {
    client = await databases.open(
      target,
      `${probePsl(databases, target)}
model Legacy {
  id    String @id
  label String

  @@map("legacy")
}
`,
    );
  }, timeouts.hook);

  const probe = (id: string, fields: Record<string, unknown> = {}) =>
    adapterOver(client).create({ model: 'probe', data: { id, ...fields }, forceAllowId: true });

  describe('every call filters', () => {
    it('delete removes every matching row', async () => {
      for (const id of ['d1', 'd2', 'd3']) await probe(id, { n: 90 });
      const adapter = adapterOver(client);
      await adapter.delete({ model: 'probe', where: [{ field: 'n', value: 90 }] });
      expect(await adapter.count({ model: 'probe', where: [{ field: 'n', value: 90 }] })).toBe(0);
    });

    it('updateMany setting the values a row has returns the rows matched', async () => {
      for (const id of ['u1', 'u2', 'u3']) await probe(id, { n: 91 });
      const matched = await adapterOver(client).updateMany({
        model: 'probe',
        where: [{ field: 'n', value: 91 }],
        update: { n: 91 },
      });
      expect(matched).toBe(3);
    });

    it('a read without select does not return a column the application added', async () => {
      await probe('r1', { text: 'read' });
      const { client: recorded, recording } = recordingClient(client);
      const found = await adapterOver(recorded).findOne({
        model: 'probe',
        where: [{ field: 'id', value: 'r1' }],
      });
      expect(found).toMatchObject({ id: 'r1', text: 'read' });
      const [row] = recording.results;
      expect(recording.calls).toContain('select');
      expect(row).toMatchObject({ id: 'r1', text: 'read' });
      expect(row).not.toHaveProperty('extra');
    });

    it('serves a model whose table is marked disableMigrations', async () => {
      const adapter = adapterOver(client, legacyOptions);
      await adapter.create({ model: 'legacy', data: { label: 'kept' } });
      expect(
        await adapter.findOne({ model: 'legacy', where: [{ field: 'label', value: 'kept' }] }),
      ).toMatchObject({ label: 'kept' });
    });
  });

  describe('refused comparisons', () => {
    it('sorting by a boolean', async () => {
      await expect(
        adapterOver(client).findMany({
          model: 'probe',
          sortBy: { field: 'flag', direction: 'asc' },
        }),
      ).rejects.toThrow(
        `Field "Probe.flag" (${target === 'sqlite' ? 'sqlite/boolean@1' : 'pg/bool@1'}) does not support sorting.`,
      );
    });

    it('a sort direction other than asc or desc', async () => {
      const direction = blindCast<
        'asc',
        'a Better Auth plugin can pass a request value through sortBy at run time'
      >('constructor');
      await expect(
        adapterOver(client).findMany({ model: 'probe', sortBy: { field: 'n', direction } }),
      ).rejects.toThrow(
        expect.objectContaining({
          name: 'BetterAuthError',
          message: 'Sort direction "constructor" is not supported.',
        }),
      );
    });

    it('lt on a boolean', async () => {
      await expect(
        adapterOver(client).findMany({
          model: 'probe',
          where: [{ field: 'flag', operator: 'lt', value: true }],
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          name: 'BetterAuthError',
          message: `Field "Probe.flag" (${target === 'sqlite' ? 'sqlite/boolean@1' : 'pg/bool@1'}) does not support lt.`,
        }),
      );
    });
  });

  describe("Better Auth's atomic fallbacks", () => {
    it('consume a verification row once when four concurrent calls have all read it', async () => {
      const { client: recorded, recording } = recordingClient(client);
      const adapter = adapterOver(recorded);
      await adapter.create({
        model: 'verification',
        data: {
          identifier: 'consume-once',
          value: 'token',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const consumed = await Promise.all(
        Array.from({ length: 4 }, () =>
          adapter.consumeOne({
            model: 'verification',
            where: [{ field: 'identifier', value: 'consume-once' }],
          }),
        ),
      );
      const reads = recording.calls.filter((call) => call === 'first').length;
      const firstDelete = recording.calls.indexOf('deleteAndCount');
      expect(reads).toBe(4);
      expect(recording.calls.slice(0, firstDelete).filter((call) => call === 'first')).toHaveLength(
        4,
      );
      expect(consumed.filter((row) => row !== null)).toHaveLength(1);
      expect(
        await adapter.count({
          model: 'verification',
          where: [{ field: 'identifier', value: 'consume-once' }],
        }),
      ).toBe(0);
    });

    it("increment rate limiting's counter, guarded by its bigint field", async () => {
      const adapter = adapterOver(client);
      const lastRequest = Date.now();
      await adapter.create({
        model: 'rateLimit',
        data: { key: 'increment', count: 1, lastRequest },
      });
      const incremented = await adapter.incrementOne({
        model: 'rateLimit',
        where: [{ field: 'key', value: 'increment' }],
        increment: { count: 1 },
        set: { lastRequest: lastRequest + 1 },
      });
      expect(incremented).toMatchObject({ count: 2, lastRequest: lastRequest + 1 });
      expect(
        await adapter.findOne({
          model: 'rateLimit',
          where: [{ field: 'key', value: 'increment' }],
        }),
      ).toMatchObject({ count: 2, lastRequest: lastRequest + 1 });
    });

    it('a guarded update that sets a date to null', async () => {
      await probe('g1', { n: 1, at: new Date() });
      const adapter = adapterOver(client);
      const updated = await adapter.incrementOne({
        model: 'probe',
        where: [{ field: 'id', value: 'g1' }],
        increment: { n: 1 },
        set: { at: null },
      });
      expect(updated).toMatchObject({ n: 2, at: null });
      expect(
        await adapter.findOne({ model: 'probe', where: [{ field: 'id', value: 'g1' }] }),
      ).toMatchObject({ n: 2, at: null });
    });
  });

  describe('transactions', () => {
    it('roll back a failing callback with the transaction option', async () => {
      const adapter = adapterOver(client, probeOptions, { transaction: true });
      await expect(
        adapter.transaction(async (trx) => {
          await trx.create({ model: 'probe', data: { id: 't1' }, forceAllowId: true });
          throw new Error('fails after the write');
        }),
      ).rejects.toThrow('fails after the write');
      expect(await adapter.count({ model: 'probe', where: [{ field: 'id', value: 't1' }] })).toBe(
        0,
      );
    });

    it('run the callback without a database transaction by default', async () => {
      const adapter = adapterOver(client);
      await expect(
        adapter.transaction(async (trx) => {
          await trx.create({ model: 'probe', data: { id: 't2' }, forceAllowId: true });
          throw new Error('fails after the write');
        }),
      ).rejects.toThrow('fails after the write');
      expect(await adapter.count({ model: 'probe', where: [{ field: 'id', value: 't2' }] })).toBe(
        1,
      );
    });
  });
});

describe('refused comparisons on postgres', () => {
  it('eq on a Json field', async () => {
    const client = await databases.open('postgres', probePsl(databases, 'postgres'));
    await expect(
      prismaAdapter(client)(probeOptions).findMany({
        model: 'probe',
        where: [{ field: 'meta', value: '{}' }],
      }),
    ).rejects.toThrow('Field "Probe.meta" (pg/json@1) does not support eq.');
  });
});

describe.each(targets)('joins on %s', (target) => {
  const joinOptions: BetterAuthOptions = { advanced: { database: { joins: true } } };

  async function userWithSessions(psl: string) {
    const client = await databases.open(target, psl);
    const adapter = prismaAdapter(client)(joinOptions);
    const user = await adapter.create<{ id: string }>({
      model: 'user',
      data: {
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const sessions: { id: string }[] = [];
    for (const token of ['first-token', 'second-token']) {
      sessions.push(
        await adapter.create<{ id: string }>({
          model: 'session',
          data: {
            token,
            userId: user.id,
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      );
    }
    return { client, user, sessions };
  }

  const queries = (calls: readonly string[]) =>
    calls.filter((call) => call === 'first' || call === 'all');

  it('serves a join with include, in one query, when the contract declares the relation', async () => {
    const { client, user, sessions } = await userWithSessions(
      pslForConfiguration(databases.emptyContract(target), {}),
    );

    const toOne = recordingClient(client);
    const session = await prismaAdapter(toOne.client)(joinOptions).findOne({
      model: 'session',
      where: [{ field: 'id', value: sessions[0]?.id ?? '' }],
      join: { user: true },
    });
    expect(session).toMatchObject({ user: { id: user.id, name: 'Ada' } });
    expect(toOne.recording.calls.filter((call) => call === 'include')).toHaveLength(1);
    expect(queries(toOne.recording.calls)).toEqual(['first']);

    const toMany = recordingClient(client);
    const users = await prismaAdapter(toMany.client)(joinOptions).findMany<{
      session: { id: string }[];
    }>({ model: 'user', where: [{ field: 'id', value: user.id }], join: { session: true } });
    expect(users[0]?.session.map((row) => row.id).sort()).toEqual(
      sessions.map((row) => row.id).sort(),
    );
    expect(toMany.recording.calls.filter((call) => call === 'include')).toHaveLength(1);
    expect(queries(toMany.recording.calls)).toEqual(['all']);
  });

  it('leaves a join to Better Auth, and logs it, when the contract declares no relation', async () => {
    const withoutRelations = pslForConfiguration(databases.emptyContract(target), {})
      .split('\n')
      .filter((line) => !line.includes('@relation(') && !/\[\]$/.test(line))
      .join('\n');
    const { client, user, sessions } = await userWithSessions(withoutRelations);
    const logged: string[] = [];
    const spies = (['log', 'info'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      }),
    );
    try {
      const { client: recorded, recording } = recordingClient(client);
      const joined = await prismaAdapter(recorded, { debugLogs: true })(joinOptions).findOne({
        model: 'session',
        where: [{ field: 'id', value: sessions[0]?.id ?? '' }],
        join: { user: true },
      });
      expect(joined).toMatchObject({ user: { id: user.id, name: 'Ada' } });
      expect(recording.calls).not.toContain('include');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(logged.join('\n')).toContain(
      'Join of "user" on "Session" runs as separate queries: the contract declares no relation from Session.userId to user.id. Declare the relation to join in one query.',
    );
  });
});
