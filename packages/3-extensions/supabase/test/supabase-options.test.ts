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

  it('rejects a pgClient binding with SUPABASE.CONFIG_INVALID', async () => {
    const client = new Client();
    const binding = { kind: 'pgClient', client } as unknown as NonNullable<ReadOptions['binding']>;

    await expect(supabase({ contract, jwtSecret, binding })).rejects.toMatchObject({
      code: 'SUPABASE.CONFIG_INVALID',
      message: 'The binding option takes a url or pgPool binding',
    });
  });

  it('rejects more than one binding input with RUNTIME.BINDING_INVALID', async () => {
    await expect(
      supabase({ contract, jwtSecret, url, binding: { kind: 'url', url } }),
    ).rejects.toMatchObject({ code: 'RUNTIME.BINDING_INVALID' });
  });
});
