import { createCacheMiddleware } from '@prisma/orm-extension-middleware-cache';
import pgvector from '@prisma/orm-extension-pgvector/runtime';
import { budgets, type Runtime, type SqlMiddleware } from '@prisma/orm-postgres/family-runtime';
import postgres from '@prisma/orm-postgres/runtime';
import { contract } from '../../prisma/contract';

export async function getRuntime(
  databaseUrl: string,
  middleware: readonly SqlMiddleware[] = [
    createCacheMiddleware(),
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      tableRows: { user: 10_000, post: 10_000 },
      maxLatencyMs: 1_000,
    }),
  ],
): Promise<Runtime> {
  const client = postgres({
    contract,
    url: databaseUrl,
    middleware,
    extensions: [pgvector],
  });
  return client.connect();
}
