import { contractFromJson } from '@internal/postgres/static';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Submittable {
  submit: (...args: unknown[]) => unknown;
  read: (size: number, callback: (error: Error | null, rows: unknown[]) => void) => void;
  close: (callback: (error?: Error | null) => void) => void;
}

const recorded = vi.hoisted(() => ({
  cursorReadSizes: [] as number[],
  bufferedAppReads: 0,
}));

vi.mock('pg', () => {
  function isSubmittable(value: unknown): value is Submittable {
    return (
      typeof value === 'object' &&
      value !== null &&
      'submit' in value &&
      typeof value.submit === 'function'
    );
  }

  function query(request: unknown) {
    if (isSubmittable(request)) {
      request.read = (size, callback) => {
        recorded.cursorReadSizes.push(size);
        callback(null, []);
      };
      request.close = (callback) => callback(null);
      return request;
    }
    const text = typeof request === 'string' ? request : (request as { text: string }).text;
    if (text.includes('"profile"')) recorded.bufferedAppReads += 1;
    return Promise.resolve({ rows: [], rowCount: 0 });
  }

  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn(async () => {
      return { query, release: vi.fn(), on: vi.fn(), off: vi.fn(), removeListener: vi.fn() };
    });
    end = vi.fn().mockResolvedValue(undefined);
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
  }

  class Client {
    on = vi.fn().mockReturnThis();
    escapeIdentifier = vi.fn();
    escapeLiteral = vi.fn();
  }

  return { Pool, Client };
});

import { Client, Pool } from 'pg';
import supabase, { type SupabaseOptions } from '../src/runtime/supabase';
import type { Contract } from './fixtures/example-app/contract';
import contractJson from './fixtures/example-app/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);
const jwtSecret = 'fixture-jwt-signing-input-not-a-real-credential';
const url = 'postgres://localhost/db';

type ReadOptions = Pick<SupabaseOptions<Contract>, 'url' | 'binding' | 'cursor'>;

async function readProfilesAsAnon(options: ReadOptions): Promise<void> {
  const db = await supabase({ contract, jwtSecret, verifyMarker: false, ...options });
  try {
    const anon = db.asAnon();
    await anon.query(anon.sql.public.profile.select('id').build()).toArray();
  } finally {
    await db.close();
  }
}

beforeEach(() => {
  recorded.cursorReadSizes.length = 0;
  recorded.bufferedAppReads = 0;
});

describe('supabase() cursor option', () => {
  it('reads without a cursor by default', async () => {
    await readProfilesAsAnon({ url });

    expect(recorded).toMatchObject({ cursorReadSizes: [], bufferedAppReads: 1 });
  });

  it('reads through a cursor in batches of batchSize', async () => {
    await readProfilesAsAnon({ url, cursor: { batchSize: 500 } });

    expect(recorded).toMatchObject({ cursorReadSizes: [500], bufferedAppReads: 0 });
  });

  it('reads through a cursor in batches of 100 when cursor is {}', async () => {
    await readProfilesAsAnon({ url, cursor: {} });

    expect(recorded.cursorReadSizes).toEqual([100]);
  });

  it('reads the Supabase contract through the same cursor, on the shared driver', async () => {
    const db = await supabase({
      contract,
      jwtSecret,
      url,
      verifyMarker: false,
      cursor: { batchSize: 7 },
    });
    try {
      const internal = db.asServiceRole().supabase;
      await internal.query(internal.sql.auth.users.select('id').build()).toArray();
    } finally {
      await db.close();
    }

    expect(recorded.cursorReadSizes).toEqual([7]);
  });

  it('rejects a batchSize that is not a positive integer', async () => {
    await expect(
      supabase({ contract, jwtSecret, url, cursor: { batchSize: 0 } }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ARGUMENT_INVALID',
      message: 'Invalid cursor option',
      meta: { helper: 'supabase', argument: 'cursor', received: { batchSize: 0 } },
    });
  });
});

describe('supabase() binding option', () => {
  it('connects through a url binding', async () => {
    await readProfilesAsAnon({ binding: { kind: 'url', url } });

    expect(recorded.bufferedAppReads).toBe(1);
  });

  it('connects through a pgPool binding and leaves the pool open', async () => {
    const pool = new Pool();

    await readProfilesAsAnon({ binding: { kind: 'pgPool', pool } });

    expect(recorded.bufferedAppReads).toBe(1);
    expect(pool.end).not.toHaveBeenCalled();
  });

  it('rejects a pg.Client, as pg or as a pgClient binding, with one SUPABASE.CONFIG_INVALID error', async () => {
    const client = new Client();
    const binding = { kind: 'pgClient', client } as unknown as NonNullable<ReadOptions['binding']>;
    const pg = client as unknown as Pool;
    const refusal = {
      code: 'SUPABASE.CONFIG_INVALID',
      message: 'Supabase takes a pg.Pool or a url, not a pg.Client',
    };

    await expect(supabase({ contract, jwtSecret, binding })).rejects.toMatchObject(refusal);
    await expect(supabase({ contract, jwtSecret, pg })).rejects.toMatchObject(refusal);
  });

  it('rejects a pg object that is neither a pool nor a client with RUNTIME.BINDING_INVALID, as postgres() does', async () => {
    const pg = {} as unknown as Pool;

    await expect(supabase({ contract, jwtSecret, pg })).rejects.toMatchObject({
      code: 'RUNTIME.BINDING_INVALID',
    });
  });

  it.each([
    ['pg', { pg: null }],
    ['url', { url: null }],
    ['binding', { binding: null }],
  ])('rejects %s: null with RUNTIME.BINDING_INVALID', async (_name, input) => {
    await expect(
      supabase({ contract, jwtSecret, ...(input as unknown as ReadOptions) }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.BINDING_INVALID',
      why: expect.any(String),
      fix: expect.any(String),
      meta: { received: null },
    });
  });

  it('rejects more than one binding input with RUNTIME.BINDING_INVALID', async () => {
    await expect(
      supabase({ contract, jwtSecret, url, binding: { kind: 'url', url } }),
    ).rejects.toMatchObject({ code: 'RUNTIME.BINDING_INVALID' });
  });
});
