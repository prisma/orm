import { budgets, lints } from '@prisma/orm-postgres/family-runtime';
import postgresServerless from '@prisma/orm-postgres/serverless';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

function createMiddleware() {
  return [
    lints(),
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      tableRows: { user: 10_000, post: 10_000 },
      maxLatencyMs: 5_000,
    }),
  ];
}

/**
 * Serverless client, built once per isolate. It holds no database connection. Each request opens
 * its own connection with `postgres.connect({ url })`.
 */
export const postgres = postgresServerless({
  contract,
  middleware: createMiddleware(),
});

/**
 * Serverless client with cursors on, used only by the `/cursor/large` route to stream a large
 * result. Reads through its connections hang behind Cloudflare Hyperdrive.
 */
export const streamingPostgres = postgresServerless({
  contract,
  middleware: createMiddleware(),
  cursor: { batchSize: 100 },
});
