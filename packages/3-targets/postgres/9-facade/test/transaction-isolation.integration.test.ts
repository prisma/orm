import { createDevDatabase, timeouts } from '@repo/test-utils';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import postgres from '../src/exports/runtime';
import postgresServerless from '../src/exports/serverless';
import { contractFromJson } from '../src/exports/static';
import type { Contract } from './fixtures/generated/contract';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);

describe.each(['pooled', 'serverless'] as const)(
  '%s callback isolation on the database',
  (transport) => {
    it(
      'rolls back timed callback writes and reuses the connection while refusing late work',
      async () => {
        const database = await createDevDatabase();
        const pool = new pg.Pool({ connectionString: database.connectionString, max: 1 });
        const options = {
          contract,
          verifyMarker: false as const,
          transactionOptions: { timeout: 100 },
        };
        const db =
          transport === 'pooled'
            ? postgres({ ...options, pg: pool })
            : await postgresServerless(options).connect({ url: database.connectionString });
        try {
          await db.execute(
            db.raw.sql`CREATE TABLE timeout_rows (id INTEGER)`.affectedCount().build(),
          );
          const rows = db.raw.sql`SELECT id FROM timeout_rows`
            .returnsRow({ id: 'pg/int4@1' })
            .build();
          let late: (() => Promise<unknown>) | undefined;
          await expect(
            db.transaction(async (tx) => {
              late = async () => tx.query(rows).toArray();
              await tx.execute(
                tx.raw.sql`INSERT INTO timeout_rows VALUES (1)`.affectedCount().build(),
              );
              await new Promise<void>(() => {});
            }),
          ).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_TIMEOUT' });
          expect(await db.query(rows).toArray()).toEqual([]);
          expect(late).toBeDefined();
          await expect(late?.()).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_CLOSED' });
          await expect(db.transaction(async () => 42, { timeout: null })).resolves.toBe(42);
        } finally {
          await db.close();
          await pool.end();
          await database.close();
        }
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'applies defaults and overrides while manual starts keep the session baseline',
      async () => {
        const database = await createDevDatabase();
        const pool = new pg.Pool({ connectionString: database.connectionString, max: 1 });
        const options = {
          contract,
          verifyMarker: false as const,
          transactionOptions: { isolationLevel: 'ReadCommitted' as const },
        };
        const db =
          transport === 'pooled'
            ? postgres({ ...options, pg: pool })
            : await postgresServerless(options).connect({ url: database.connectionString });
        try {
          await db.execute(
            db.raw.sql`SET default_transaction_isolation = 'repeatable read'`
              .affectedCount()
              .build(),
          );
          const plan = db.raw.sql`SHOW transaction_isolation`
            .returnsRow({ transaction_isolation: 'pg/text@1' })
            .build();
          expect(await db.transaction(async (tx) => tx.query(plan).toArray())).toEqual([
            { transaction_isolation: 'read committed' },
          ]);
          expect(
            await db.transaction(async (tx) => tx.query(plan).toArray(), {
              isolationLevel: 'Serializable',
            }),
          ).toEqual([{ transaction_isolation: 'serializable' }]);
          expect(
            await db.transaction(async (tx) => tx.query(plan).toArray(), {
              isolationLevel: undefined,
            }),
          ).toEqual([{ transaction_isolation: 'read committed' }]);
          const connection = await db.runtime().connection();
          const manual = await connection.transaction();
          expect(await manual.query(plan).toArray()).toEqual([
            { transaction_isolation: 'repeatable read' },
          ]);
          await manual.rollback();
          await connection.release();
        } finally {
          await db.close();
          await pool.end();
          await database.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  },
);
