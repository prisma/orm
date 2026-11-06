import { createCacheMiddleware } from '@prisma/orm-extension-middleware-cache';
import pgvector from '@prisma/orm-extension-pgvector/runtime';
import { budgets, type SqlMiddleware } from '@prisma/orm-postgres/family-runtime';
import postgres from '@prisma/orm-postgres/runtime';
import { contract } from '../../prisma/contract';
import { MissingNamespaceError } from '../errors';
import { PostCollection, UserCollection } from '../orm-client/collections';

export async function connectClient(
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
) {
  const client = postgres({
    contract,
    url: databaseUrl,
    middleware,
    extensions: [pgvector],
    collections: { User: UserCollection, Post: PostCollection },
  });
  const runtime = await client.connect();
  const orm = client.orm['public'];
  if (orm === undefined) {
    throw new MissingNamespaceError('public', 'ORM client');
  }
  return { runtime, orm };
}

export type NoEmitOrm = Awaited<ReturnType<typeof connectClient>>['orm'];
