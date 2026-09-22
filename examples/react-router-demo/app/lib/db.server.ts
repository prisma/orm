import postgres, { type PostgresClient } from '@prisma/orm-postgres/runtime';
import { Pool } from 'pg';
import type { Contract } from '../../src/prisma/contract.d';
import contractJson from '../../src/prisma/contract.json' with { type: 'json' };

type Db = PostgresClient<Contract>;

let cached: { db: Db; pool: Pool } | undefined;

export function getDb(): Db {
  if (!cached) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is required to construct the Prisma 8 runtime. Set it in your environment (see .env.example) before invoking a loader or action.',
      );
    }
    // REACT_ROUTER_DEMO_PG_POOL_MAX, when set, caps the pool size. The smoke
    // test sets it to '1' so the example cohabits with @prisma/dev (PGlite),
    // which rejects concurrent connections. In production the pg default
    // applies and the framework's own pool sizing wins.
    const poolMaxRaw = process.env['REACT_ROUTER_DEMO_PG_POOL_MAX'];
    const pool = new Pool({
      connectionString,
      ...(poolMaxRaw === undefined ? {} : { max: Number(poolMaxRaw) }),
    });
    // pg emits 'error' on idle-client disconnects (e.g., the test harness
    // tearing down @prisma/dev while the pool is still around). Without a
    // listener these surface as uncaughtException. Log and move on.
    pool.on('error', (err) => {
      console.error('[react-router-demo] pg pool error:', err.message);
    });
    cached = {
      db: postgres<Contract>({ contractJson, pg: pool }),
      pool,
    };
  }
  return cached.db;
}

// Drop the cached client whenever Vite re-executes this module so HMR after a
// contract re-emit rebuilds the runtime against the fresh contractJson instead
// of reusing the stale one.
// TODO(TML-2368): replace this example-local cache with a hash-keyed dev
// helper shared across frameworks.
// https://linear.app/prisma-company/issue/TML-2368
if (import.meta.hot) {
  import.meta.hot.dispose(async () => {
    if (cached) {
      const { pool } = cached;
      cached = undefined;
      await pool.end();
    }
  });
}
