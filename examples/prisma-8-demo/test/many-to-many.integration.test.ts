import { sql } from '@prisma/orm-postgres/builder/runtime';
import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import type { DefaultModelRow } from '@prisma/orm-postgres/orm-client';
import postgres from '@prisma/orm-postgres/runtime';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createOrmClient } from '../src/orm-client/client';
import { ormClientConnectPostTags } from '../src/orm-client/connect-post-tags';
import { ormClientCreatePostConnectTags } from '../src/orm-client/create-post-connect-tags';
import { ormClientCreatePostWithTags } from '../src/orm-client/create-post-with-tags';
import { ormClientDisconnectPostTags } from '../src/orm-client/disconnect-post-tags';
import { ormClientGetPostTags } from '../src/orm-client/get-post-tags';
import { ormClientGetPostsByTagFilter } from '../src/orm-client/get-posts-by-tag-filter';
import { ormClientGetTagPosts } from '../src/orm-client/get-tag-posts';
import type { Contract } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };
import { db } from '../src/prisma/db';
import { initTestDatabase } from './utils/control-client';

const context = db.context;
const { contract } = context;
const Priority = db.enums.public.Priority;

type PostId = DefaultModelRow<Contract, 'Post'>['id'];

async function getRuntime(connectionString: string): Promise<Runtime> {
  const client = postgres<Contract>({
    contractJson,
    url: connectionString,
    extensions: db.stack.extensions,
  });
  return client.connect();
}

const authorId = '00000000-0000-0000-0000-000000000001';

const seededPostIds = {
  alpha: '10000000-0000-0000-0000-000000000001',
  beta: '10000000-0000-0000-0000-000000000002',
  untagged: '10000000-0000-0000-0000-000000000003',
} as const;

const seededTagIds = {
  typescript: '30000000-0000-0000-0000-000000000001',
  orm: '30000000-0000-0000-0000-000000000002',
  demo: '30000000-0000-0000-0000-000000000003',
} as const;

// Alpha carries typescript + orm, Beta carries orm only, and the third post
// stays untagged so the `every` filter's vacuous-truth semantics are visible.
async function seedManyToManyData(runtime: Runtime): Promise<void> {
  const sqlDb = sql({ context, rawCodecInferer: { inferCodec: () => 'pg/text' } }).public;

  await runtime.execute(
    sqlDb.user
      .insert([
        {
          id: authorId,
          email: 'author@example.com',
          displayName: 'Author',
          createdAt: Temporal.Instant.from('2024-01-01T00:00:00.000Z'),
          kind: 'user' as const,
        },
      ])
      .build(),
  );

  const posts = [
    { id: seededPostIds.alpha, title: 'Alpha post' },
    { id: seededPostIds.beta, title: 'Beta post' },
    { id: seededPostIds.untagged, title: 'Untagged post' },
  ];
  for (const [index, post] of posts.entries()) {
    await runtime.execute(
      sqlDb.post
        .insert([
          {
            id: post.id,
            title: post.title,
            userId: authorId,
            priority: Priority.members.Low,
            createdAt: Temporal.Instant.from(`2024-01-0${index + 1}T10:00:00.000Z`),
          },
        ])
        .build(),
    );
  }

  const tags = [
    { id: seededTagIds.typescript, label: 'typescript' },
    { id: seededTagIds.orm, label: 'orm' },
    { id: seededTagIds.demo, label: 'demo' },
  ];
  for (const tag of tags) {
    await runtime.execute(sqlDb.tag.insert([tag]).build());
  }

  await runtime.execute(
    sqlDb.post_tag
      .insert([
        { postId: seededPostIds.alpha, tagId: seededTagIds.typescript },
        { postId: seededPostIds.alpha, tagId: seededTagIds.orm },
        { postId: seededPostIds.beta, tagId: seededTagIds.orm },
      ])
      .build(),
  );
}

describe('ORM client many-to-many examples', () => {
  it(
    'ormClientGetPostTags includes the tags of a post through the junction',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedManyToManyData(runtime);
          const post = await ormClientGetPostTags(seededPostIds.alpha, runtime);

          expect(post).toEqual({
            id: seededPostIds.alpha,
            title: 'Alpha post',
            tags: [
              { id: seededTagIds.orm, label: 'orm' },
              { id: seededTagIds.typescript, label: 'typescript' },
            ],
          });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetTagPosts walks the same junction from the tag side',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedManyToManyData(runtime);
          const tag = await ormClientGetTagPosts(seededTagIds.orm, runtime);

          expect(tag).toEqual({
            id: seededTagIds.orm,
            label: 'orm',
            posts: [
              { id: seededPostIds.alpha, title: 'Alpha post' },
              { id: seededPostIds.beta, title: 'Beta post' },
            ],
          });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'Post.include of tags without a refinement returns the full default shapes',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedManyToManyData(runtime);
          const orm = createOrmClient(runtime);
          const post = await orm.Post.include('tags')
            .where({ id: seededPostIds.beta as PostId })
            .first();

          expect(post).toEqual({
            id: seededPostIds.beta,
            title: 'Beta post',
            userId: authorId,
            priority: 'low',
            createdAt: Temporal.Instant.from('2024-01-02T10:00:00.000Z'),
            embedding: null,
            viewCount: null,
            impressionCount: null,
            reachScore: null,
            tags: [{ id: seededTagIds.orm, label: 'orm' }],
          });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetPostsByTagFilter covers the some, none, and every predicates',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedManyToManyData(runtime);

          const some = await ormClientGetPostsByTagFilter('some', 'typescript', runtime);
          expect(some).toEqual([{ id: seededPostIds.alpha, title: 'Alpha post' }]);

          const none = await ormClientGetPostsByTagFilter('none', 'typescript', runtime);
          expect(none).toEqual([
            { id: seededPostIds.beta, title: 'Beta post' },
            { id: seededPostIds.untagged, title: 'Untagged post' },
          ]);

          // Vacuous truth: the untagged post satisfies `every`.
          const every = await ormClientGetPostsByTagFilter('every', 'typescript', runtime);
          expect(every).toEqual([
            { id: seededPostIds.beta, title: 'Beta post' },
            { id: seededPostIds.untagged, title: 'Untagged post' },
          ]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientConnectPostTags links existing tags and reads back the updated list',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedManyToManyData(runtime);
          const post = await ormClientConnectPostTags(
            seededPostIds.untagged,
            [seededTagIds.demo, seededTagIds.typescript],
            runtime,
          );

          expect(post).toEqual({
            id: seededPostIds.untagged,
            title: 'Untagged post',
            tags: [
              { id: seededTagIds.demo, label: 'demo' },
              { id: seededTagIds.typescript, label: 'typescript' },
            ],
          });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientDisconnectPostTags unlinks tags and reads back the remaining list',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedManyToManyData(runtime);
          const post = await ormClientDisconnectPostTags(
            seededPostIds.alpha,
            [seededTagIds.orm],
            runtime,
          );

          expect(post).toEqual({
            id: seededPostIds.alpha,
            title: 'Alpha post',
            tags: [{ id: seededTagIds.typescript, label: 'typescript' }],
          });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientCreatePostWithTags creates the post and new tags in one nested mutation',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedManyToManyData(runtime);
          const newPostId = '20000000-0000-0000-0000-000000000001';
          const created = await ormClientCreatePostWithTags(
            {
              id: newPostId,
              title: 'Fresh post',
              userId: authorId,
              tags: [{ label: 'fresh' }, { label: 'brand-new' }],
            },
            runtime,
          );

          expect(created).toEqual({
            id: newPostId,
            title: 'Fresh post',
            userId: authorId,
            priority: 'low',
            createdAt: expect.any(Temporal.Instant),
            embedding: null,
            viewCount: null,
            impressionCount: null,
            reachScore: null,
          });

          const readBack = await ormClientGetPostTags(newPostId, runtime);
          expect(readBack).toEqual({
            id: newPostId,
            title: 'Fresh post',
            tags: [
              { id: expect.any(String), label: 'brand-new' },
              { id: expect.any(String), label: 'fresh' },
            ],
          });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientCreatePostConnectTags links existing tags in the create flow',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedManyToManyData(runtime);
          const newPostId = '20000000-0000-0000-0000-000000000002';
          const created = await ormClientCreatePostConnectTags(
            {
              id: newPostId,
              title: 'Connected post',
              userId: authorId,
              tagIds: [seededTagIds.typescript, seededTagIds.demo],
            },
            runtime,
          );

          expect(created).toEqual({
            id: newPostId,
            title: 'Connected post',
            userId: authorId,
            priority: 'low',
            createdAt: expect.any(Temporal.Instant),
            embedding: null,
            viewCount: null,
            impressionCount: null,
            reachScore: null,
          });

          const readBack = await ormClientGetPostTags(newPostId, runtime);
          expect(readBack).toEqual({
            id: newPostId,
            title: 'Connected post',
            tags: [
              { id: seededTagIds.demo, label: 'demo' },
              { id: seededTagIds.typescript, label: 'typescript' },
            ],
          });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
