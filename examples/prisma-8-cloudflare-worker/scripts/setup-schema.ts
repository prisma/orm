/**
 * Applies the contract schema to a local Postgres origin via `prisma db init`, then creates the
 * `pg_stat_statements` extension that the `/cursor/large` route reads.
 *
 * Loads `.env`, then reads WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
 * (the same env var Wrangler uses for the Hyperdrive binding's local connection string),
 * falling back to `DATABASE_URL`. Idempotent: safe to re-run.
 */
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { EXAMPLE_ROOT, HYPERDRIVE_VAR, loadLocalEnv } from './env';

loadLocalEnv(EXAMPLE_ROOT);
const url = process.env[HYPERDRIVE_VAR] ?? process.env['DATABASE_URL'];

if (!url) {
  console.error(
    `Set ${HYPERDRIVE_VAR} in .env (or DATABASE_URL in the environment) before running db:init.`,
  );
  console.error('Hint: `pnpm db:dev` prints the TCP URL.');
  process.exit(1);
}

const result = spawnSync('pnpm', ['exec', 'prisma', 'db', 'init', '--db', url, '--yes'], {
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const client = new Client({ connectionString: url });
await client.connect();
try {
  await client.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
} finally {
  await client.end();
}
