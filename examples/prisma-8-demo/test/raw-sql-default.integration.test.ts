import pgvector from '@prisma/orm-extension-pgvector/runtime';
import postgres from '@prisma/orm-postgres/runtime';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { contract } from '../prisma/contract';
import { sql } from '../src/prisma-no-emit/context';
import { initTestDatabase } from './utils/control-client';

const authorId = '00000000-0000-0000-0000-000000000001';
const postId = '10000000-0000-0000-0000-0000000000fe';

describe('raw SQL default on the demo contract (Post.expiresAt)', () => {
  it(
    'the database sets expiresAt seven days after createdAt',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const client = postgres({ contract, url: connectionString, extensions: [pgvector] });
        const runtime = await client.connect();
        try {
          await runtime.execute(
            sql.user.insert([{ id: authorId, email: 'author@example.com', kind: 'user' }]).build(),
          );
          await runtime.execute(
            sql.post.insert([{ id: postId, title: 'Expiring', userId: authorId }]).build(),
          );
          const rows = await runtime.query(
            sql.post
              .select('createdAt', 'expiresAt')
              .where((f, fns) => fns.eq(f.id, postId))
              .build(),
          );
          const secondsUntilExpiry = rows[0]!.expiresAt
            .since(rows[0]!.createdAt)
            .total({ unit: 'seconds' });
          expect(Math.abs(secondsUntilExpiry - 7 * 24 * 60 * 60)).toBeLessThan(60);
        } finally {
          await client.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );
});
