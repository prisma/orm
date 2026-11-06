import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime';
import postgres from '@prisma/orm-postgres/runtime';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { collections } from '../src/orm-client/collections';
import { ormClientLockUserPosts } from '../src/orm-client/lock-user-posts';
import { contract, db } from '../src/prisma/db';
import { initTestDatabase } from './utils/control-client';

const authorId = '00000000-0000-0000-0000-000000000001';
const otherAuthorId = '00000000-0000-0000-0000-000000000002';

function recordActivities(events: string[]): SqlMiddleware {
  return {
    name: 'record-activities',
    familyId: 'sql',
    async activityStarted(activity) {
      if (activity.kind === 'transaction') events.push('transaction started');
    },
    async beforeEncode(plan) {
      events.push(plan.sql);
    },
    async activityEnded(activity) {
      if (activity.kind === 'transaction') events.push('transaction ended');
    },
  };
}

describe('ormClientLockUserPosts', () => {
  it(
    'locks the posts the custom Post.forUser() method selects, inside a transaction',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const events: string[] = [];
        const client = postgres({
          contract,
          url: connectionString,
          extensions: db.stack.extensions,
          middleware: [recordActivities(events)],
          collections,
        });

        try {
          const orm = client.orm.public;
          for (const [id, email] of [
            [authorId, 'author@example.com'],
            [otherAuthorId, 'other@example.com'],
          ] as const) {
            await orm.User.create({
              id,
              email,
              displayName: email,
              kind: 'user',
              createdAt: Temporal.Instant.from('2024-01-01T00:00:00.000Z'),
            });
          }
          await orm.Post.create({
            id: '10000000-0000-0000-0000-000000000001',
            title: 'Older post',
            userId: authorId,
            createdAt: Temporal.Instant.from('2024-01-01T10:00:00.000Z'),
          });
          await orm.Post.create({
            id: '10000000-0000-0000-0000-000000000002',
            title: 'Newer post',
            userId: authorId,
            createdAt: Temporal.Instant.from('2024-01-02T10:00:00.000Z'),
          });
          await orm.Post.create({
            id: '10000000-0000-0000-0000-000000000003',
            title: 'Other author post',
            userId: otherAuthorId,
            createdAt: Temporal.Instant.from('2024-01-03T10:00:00.000Z'),
          });
          events.length = 0;

          const posts = await client.transaction((tx) =>
            ormClientLockUserPosts(authorId, tx.orm.public),
          );

          expect({ posts, events }).toEqual({
            posts: [
              { id: '10000000-0000-0000-0000-000000000002', title: 'Newer post' },
              { id: '10000000-0000-0000-0000-000000000001', title: 'Older post' },
            ],
            events: [
              'transaction started',
              'SELECT "post"."id" AS "id", "post"."title" AS "title" FROM "public"."post" ' +
                'WHERE "post"."userId" = $1::uuid ORDER BY "post"."createdAt" DESC FOR UPDATE OF "post"',
              'transaction ended',
            ],
          });
        } finally {
          await client.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
