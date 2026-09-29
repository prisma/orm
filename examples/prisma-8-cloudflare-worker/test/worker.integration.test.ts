import { env, SELF } from 'cloudflare:test';
import { Client } from 'pg';
import { describe, expect, inject, it, vi } from 'vitest';
import { postgres } from '../src/prisma/db';
import { countPostRowsSent } from './rows-sent';

const ALICE = inject('alice-id');
const BOB = inject('bob-id');

async function get(path: string): Promise<Response> {
  return await SELF.fetch(new Request(`https://worker.local${path}`));
}

describe('worker — postgresServerless against Hyperdrive (local)', () => {
  it('boots and responds to /health without a database connection', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('SQL DSL select returns seeded users', async () => {
    const res = await get('/sql/users?limit=5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; rows: { id: string; email: string }[] };
    expect(body.ok).toBe(true);
    expect(body.rows.length).toBe(2);
    expect(body.rows.map((r) => r.email).sort()).toEqual(['alice@example.com', 'bob@example.com']);
  });

  it('ORM client list returns seeded users', async () => {
    const res = await get('/orm/users?limit=10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; rows: { id: string; email: string }[] };
    expect(body.ok).toBe(true);
    expect(body.rows.length).toBe(2);
  });

  it('ORM relation traversal returns posts for a user', async () => {
    const res = await get(`/orm/posts?userId=${ALICE}&limit=10`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; rows: { userId: string }[] };
    expect(body.ok).toBe(true);
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every((row) => row.userId === ALICE)).toBe(true);
  });

  it('db.transaction commits a multi-statement transaction', async () => {
    const res = await get(`/tx/commit?userId=${BOB}&displayName=Bob+the+Builder`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; committed?: boolean };
    expect(body.ok).toBe(true);
    expect(body.committed).toBe(true);

    const verify = await get('/sql/users?limit=10');
    const verified = (await verify.json()) as {
      rows: { id: string; displayName: string }[];
    };
    const bob = verified.rows.find((r) => r.id === BOB);
    expect(bob?.displayName).toBe('Bob the Builder');
  });

  it('db.transaction rolls back on thrown error', async () => {
    const before = (await (await get('/sql/users?limit=10')).json()) as {
      rows: { email: string; displayName: string }[];
    };
    const aliceBefore = before.rows.find((r) => r.email === 'alice@example.com');

    const res = await get('/tx/rollback');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; message?: string };
    expect(body.ok).toBe(true);
    expect(body.message).toContain('intentional rollback');

    const after = (await (await get('/sql/users?limit=10')).json()) as {
      rows: { email: string; displayName: string }[];
    };
    const aliceAfter = after.rows.find((r) => r.email === 'alice@example.com');
    expect(aliceAfter?.displayName).toBe(aliceBefore?.displayName);
    expect(aliceAfter?.displayName).not.toBe('rolled-back-write');
  });

  it('cursor early-break consumes only the requested rows', async () => {
    const breakAfter = 7;
    const res = await get(`/cursor/large?break=${breakAfter}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      consumed: number;
      cancelled: boolean;
      elapsedMs: number;
      rowsTransmitted: number;
    };
    expect(body.ok).toBe(true);
    // global-setup seeds 10_000 posts. `consumed === breakAfter` proves the
    // for-await loop exited via `break`, not via the iterator running out.
    expect(body.consumed).toBe(breakAfter);
    expect(body.cancelled).toBe(true);
    // The behavioral assertion that demonstrably fails when cursor is
    // disabled: pg_stat_statements (queried by the route via a side-channel
    // pg.Client) reports how many rows the server actually transmitted.
    // With cursor enabled, only the first ~100-row batch is fetched before
    // the early `break` closes the cursor. With cursor disabled, the driver
    // buffers all 10_000 rows. Threshold of 500 leaves headroom for the
    // default 100-row batch size + one round of refill jitter, while still
    // failing decisively at 10_000.
    expect(body.rowsTransmitted).toBeGreaterThan(0);
    expect(body.rowsTransmitted).toBeLessThan(500);
  });

  it('the main serverless client receives the whole result before the first row', async () => {
    const connectionString = env.HYPERDRIVE.connectionString;
    await using db = await postgres.connect({ url: connectionString });
    let consumed = 0;

    const rowsSent = await countPostRowsSent(connectionString, async () => {
      const iter = db.runtime().query(
        db.sql.public.post
          .select('id', 'title')
          .orderBy((f) => f.createdAt, { direction: 'asc' })
          .limit(10_000)
          .build(),
      );
      for await (const _row of iter) {
        consumed += 1;
        if (consumed >= 7) break;
      }
    });

    expect(consumed).toBe(7);
    expect(rowsSent).toBe(10_000);
  });

  it('returns 404 for unknown routes', async () => {
    const res = await get('/no/such/route');
    expect(res.status).toBe(404);
  });

  it('connect rejects with DRIVER.CONNECTION_FAILED when the database refuses the connection', async () => {
    const error = await postgres
      .connect({ url: 'postgres://postgres:postgres@127.0.0.1:1/prisma_8_cloudflare_worker' })
      .then(
        () => undefined,
        (reason: unknown) => reason,
      );

    expect(error).toMatchObject({ code: 'DRIVER.CONNECTION_FAILED' });
    expect(JSON.stringify(error)).not.toContain(':postgres@');
  }, 10_000);

  it('/health, a 404 and a 400 open no database connection', async () => {
    const observer = new Client({ connectionString: env.HYPERDRIVE.connectionString });
    observer.on('error', () => {});
    await observer.connect();
    const sessions = async () => {
      const result = await observer.query<{ sessions: string }>(
        'SELECT sessions::text AS sessions FROM pg_stat_database WHERE datname = current_database()',
      );
      return Number(result.rows[0]?.sessions ?? '0');
    };
    try {
      // The observer's own session is counted once its backend has flushed
      // its statistics, which happens after its first command completes.
      await sessions();
      const before = await sessions();

      expect((await get('/health')).status).toBe(200);
      expect((await get('/no/such/route')).status).toBe(404);
      expect((await get('/orm/posts?userId=')).status).toBe(400);
      expect((await get('/tx/commit')).status).toBe(400);
      expect((await get('/sql/users?limit=1')).status).toBe(200);

      await vi.waitFor(async () => expect(await sessions()).toBeGreaterThanOrEqual(before + 1), {
        timeout: 5_000,
      });
      expect(await sessions()).toBe(before + 1);
    } finally {
      await observer.end();
    }
  });
});
