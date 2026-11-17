import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import type { ProvidedContext } from 'vitest';
import { EXAMPLE_ROOT, HYPERDRIVE_VAR, loadLocalEnv } from '../scripts/env';
import { GENERATED_POST_COUNT, insertGeneratedPosts } from '../scripts/seed-posts';

interface GlobalSetupContext {
  provide<K extends keyof ProvidedContext & string>(key: K, value: ProvidedContext[K]): void;
}

declare module 'vitest' {
  export interface ProvidedContext {
    'database-url': string;
    'alice-id': string;
    'bob-id': string;
  }
}

function normalize(connectionString: string): string {
  const url = new URL(connectionString);
  if (url.hostname === 'localhost' || url.hostname === '::1') {
    url.hostname = '127.0.0.1';
  }
  return url.toString();
}

function resolveDatabaseUrl(): string {
  loadLocalEnv(EXAMPLE_ROOT);
  const url = process.env[HYPERDRIVE_VAR];
  if (!url) {
    throw new Error(
      `[global-setup] ${HYPERDRIVE_VAR} not set. Run \`pnpm db:up\` and copy \`.env.example\` to \`.env\`.`,
    );
  }
  return normalize(url);
}

async function ensureContainerReady(databaseUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.query('select 1');
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      try {
        await client.end();
      } catch {
        // ignore
      }
    }
  }
  throw new Error(
    `[global-setup] Postgres at ${databaseUrl} unreachable after 15s. Did you run \`pnpm db:up\`? Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

async function applySchema(databaseUrl: string): Promise<void> {
  const result = spawnSync(
    'pnpm',
    ['exec', 'prisma', 'db', 'init', '--db', databaseUrl, '--yes', '--no-color'],
    { cwd: EXAMPLE_ROOT, stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`prisma db init failed with status ${result.status ?? 'unknown'}`);
  }
}

const ALICE_ID = '00000000-0000-4000-8000-000000000001';
const BOB_ID = '00000000-0000-4000-8000-000000000002';

async function ensurePgStatStatements(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // pg_stat_statements is preloaded via docker-compose's shared_preload_libraries;
    // CREATE EXTENSION makes its catalog views queryable from the test session.
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
  } finally {
    await client.end();
  }
}

async function resetAndSeed(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // Wipe in dependency order so re-runs against a long-lived container start clean.
    await client.query('TRUNCATE "post", "task", "user" RESTART IDENTITY CASCADE');

    await client.query(
      `INSERT INTO "user" (id, email, "displayName", "createdAt", kind, address) VALUES
        ($1, 'alice@example.com', 'Alice', '2026-04-01T00:00:00Z', 'admin',
         '{"street":"123 Main St","city":"San Francisco","zip":"94102","country":"US"}'::jsonb),
        ($2, 'bob@example.com',   'Bob',   '2026-04-02T00:00:00Z', 'user',
         '{"street":"456 Oak Ave","city":"Portland","zip":null,"country":"US"}'::jsonb)`,
      [ALICE_ID, BOB_ID],
    );

    await insertGeneratedPosts(client, [ALICE_ID, BOB_ID], GENERATED_POST_COUNT);
  } finally {
    await client.end();
  }
}

export default async function setup({ provide }: GlobalSetupContext) {
  const databaseUrl = resolveDatabaseUrl();
  console.log(`[global-setup] connecting to Postgres at ${databaseUrl}`);

  await ensureContainerReady(databaseUrl);
  await applySchema(databaseUrl);
  await ensurePgStatStatements(databaseUrl);
  await resetAndSeed(databaseUrl);

  provide('database-url', databaseUrl);
  provide('alice-id', ALICE_ID);
  provide('bob-id', BOB_ID);

  // No teardown: the container is owned by the maker (`pnpm db:up`/`pnpm db:down`).
  return async () => {};
}
