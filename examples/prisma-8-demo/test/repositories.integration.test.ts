import { createCacheMiddleware } from '@prisma/orm-extension-middleware-cache';
import { sql } from '@prisma/orm-postgres/builder/runtime';
import type { Runtime, SqlMiddleware } from '@prisma/orm-postgres/family-runtime';
import type { SqlDriver } from '@prisma/orm-postgres/relational-core/ast';
import postgres from '@prisma/orm-postgres/runtime';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ormClientAggregateUsers } from '../src/orm-client/aggregate-users';
import { createOrmClient } from '../src/orm-client/client';
import { ormClientCreateUser } from '../src/orm-client/create-user';
import { ormClientCreateUserWithAddress } from '../src/orm-client/create-user-with-address';
import { ormClientDeleteUser } from '../src/orm-client/delete-user';
import { ormClientFindSimilarPosts } from '../src/orm-client/find-similar-posts';
import { ormClientFindUserByEmail } from '../src/orm-client/find-user-by-email';
import { ormClientFindUserById } from '../src/orm-client/find-user-by-id';
import { ormClientFindUserByIdCached } from '../src/orm-client/find-user-by-id-cached';
import { ormClientGetAdminUsers } from '../src/orm-client/get-admin-users';
import { ormClientGetDashboardUsers } from '../src/orm-client/get-dashboard-users';
import { ormClientGetFeatureRoadmap } from '../src/orm-client/get-feature-roadmap';
import { ormClientGetLatestUserPerKind } from '../src/orm-client/get-latest-user-per-kind';
import { ormClientGetPostFeed } from '../src/orm-client/get-post-feed';
import { ormClientGetUserBugTriage } from '../src/orm-client/get-user-bug-triage';
import { ormClientGetUserInsights } from '../src/orm-client/get-user-insights';
import { ormClientGetUserKindBreakdown } from '../src/orm-client/get-user-kind-breakdown';
import { ormClientGetUserPosts } from '../src/orm-client/get-user-posts';
import { ormClientGetUserTaskBoard } from '../src/orm-client/get-user-task-board';
import { ormClientGetUsers } from '../src/orm-client/get-users';
import { ormClientGetUsersBackwardCursor } from '../src/orm-client/get-users-backward-cursor';
import { ormClientGetUsersByIdCursor } from '../src/orm-client/get-users-by-id-cursor';
import { ormClientGetUsersCached } from '../src/orm-client/get-users-cached';
import { ormClientSearchPostsByEmbedding } from '../src/orm-client/search-posts-by-embedding';
import { ormClientUpdateUserEmail } from '../src/orm-client/update-user-email';
import { ormClientUpsertUser } from '../src/orm-client/upsert-user';
import type { Contract } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };
import { db } from '../src/prisma/db';
import { initTestDatabase } from './utils/control-client';

const context = db.context;
const { contract } = context;
const Priority = db.enums.public.Priority;

async function getRuntime(connectionString: string): Promise<Runtime> {
  const client = postgres<Contract>({
    contractJson,
    url: connectionString,
    extensions: db.stack.extensions,
  });
  return client.connect();
}

async function getRuntimeWithMiddleware(
  connectionString: string,
  middleware: readonly SqlMiddleware[],
): Promise<{ runtime: Runtime; driver: SqlDriver<unknown> }> {
  const client = postgres<Contract>({
    contractJson,
    url: connectionString,
    middleware,
    extensions: db.stack.extensions,
  });
  const runtime = await client.connect();
  const driver = (runtime as unknown as { driver: SqlDriver<unknown> }).driver;
  return { runtime, driver };
}

const seededUserIds = {
  admin: '00000000-0000-0000-0000-000000000001',
  member: '00000000-0000-0000-0000-000000000002',
  adminTwo: '00000000-0000-0000-0000-000000000003',
  reader: '00000000-0000-0000-0000-000000000004',
} as const;

const seededPostIds = {
  older: '10000000-0000-0000-0000-000000000001',
  newer: '10000000-0000-0000-0000-000000000002',
  memberNote: '10000000-0000-0000-0000-000000000003',
  adminDeepDive: '10000000-0000-0000-0000-000000000004',
  adminZebra: '10000000-0000-0000-0000-000000000005',
} as const;

const embeddingPostIds = {
  reference: '20000000-0000-0000-0000-000000000001',
  similar1: '20000000-0000-0000-0000-000000000002',
  similar2: '20000000-0000-0000-0000-000000000003',
  dissimilar: '20000000-0000-0000-0000-000000000004',
} as const;

interface SeededTaskIds {
  readonly adminBug: string;
  readonly adminFeature: string;
  readonly memberBug: string;
  readonly memberFeature: string;
}

function makeVector(leadingValues: number[]): number[] {
  const vec = new Array<number>(1536).fill(0);
  for (let i = 0; i < leadingValues.length; i++) {
    vec[i] = leadingValues[i]!;
  }
  return vec;
}

async function seedOrmClientData(runtime: Runtime): Promise<void> {
  const db = sql({ context, rawCodecInferer: { inferCodec: () => 'pg/text' } }).public;

  const users = [
    {
      id: seededUserIds.admin,
      email: 'admin@example.com',
      displayName: 'Admin',
      createdAt: Temporal.Instant.from('2024-01-01T00:00:00.000Z'),
      kind: 'admin' as const,
    },
    {
      id: seededUserIds.member,
      email: 'member@example.com',
      displayName: 'Member',
      createdAt: Temporal.Instant.from('2024-01-02T00:00:00.000Z'),
      kind: 'user' as const,
    },
    {
      id: seededUserIds.adminTwo,
      email: 'admin2@example.org',
      displayName: 'Admin Two',
      createdAt: Temporal.Instant.from('2024-01-03T00:00:00.000Z'),
      kind: 'admin' as const,
    },
    {
      id: seededUserIds.reader,
      email: 'reader@example.com',
      displayName: 'Reader',
      createdAt: Temporal.Instant.from('2024-01-04T00:00:00.000Z'),
      kind: 'user' as const,
    },
  ];

  for (const user of users) {
    await runtime.execute(db.user.insert([user]).build());
  }

  const posts = [
    {
      id: seededPostIds.older,
      title: 'Older post',
      userId: seededUserIds.admin,
      priority: Priority.members.Low,
      createdAt: Temporal.Instant.from('2024-01-01T10:00:00.000Z'),
    },
    {
      id: seededPostIds.newer,
      title: 'Newer post',
      userId: seededUserIds.admin,
      priority: Priority.members.Low,
      createdAt: Temporal.Instant.from('2024-01-02T10:00:00.000Z'),
    },
    {
      id: seededPostIds.memberNote,
      title: 'Other user note',
      userId: seededUserIds.member,
      priority: Priority.members.Low,
      createdAt: Temporal.Instant.from('2024-01-03T10:00:00.000Z'),
    },
    {
      id: seededPostIds.adminDeepDive,
      title: 'Admin deep dive post',
      userId: seededUserIds.adminTwo,
      priority: Priority.members.Low,
      createdAt: Temporal.Instant.from('2024-01-04T10:00:00.000Z'),
    },
    {
      id: seededPostIds.adminZebra,
      title: 'Zebra post note',
      userId: seededUserIds.adminTwo,
      priority: Priority.members.Low,
      createdAt: Temporal.Instant.from('2024-01-05T10:00:00.000Z'),
    },
  ];

  for (const post of posts) {
    await runtime.execute(db.post.insert([post]).build());
  }
}

async function seedEmbeddingPosts(runtime: Runtime): Promise<void> {
  const db = sql({ context, rawCodecInferer: { inferCodec: () => 'pg/text' } }).public;
  const posts = [
    {
      id: embeddingPostIds.reference,
      title: 'Reference post',
      userId: seededUserIds.admin,
      priority: Priority.members.Low,
      createdAt: Temporal.Instant.from('2024-02-01T10:00:00.000Z'),
      embedding: makeVector([1, 0, 0]),
    },
    {
      id: embeddingPostIds.similar1,
      title: 'Very similar post',
      userId: seededUserIds.member,
      priority: Priority.members.Low,
      createdAt: Temporal.Instant.from('2024-02-02T10:00:00.000Z'),
      embedding: makeVector([0.95, 0.05, 0]),
    },
    {
      id: embeddingPostIds.similar2,
      title: 'Somewhat similar post',
      userId: seededUserIds.adminTwo,
      priority: Priority.members.Low,
      createdAt: Temporal.Instant.from('2024-02-03T10:00:00.000Z'),
      embedding: makeVector([0.7, 0.3, 0]),
    },
    {
      id: embeddingPostIds.dissimilar,
      title: 'Dissimilar post',
      userId: seededUserIds.admin,
      priority: Priority.members.Low,
      createdAt: Temporal.Instant.from('2024-02-04T10:00:00.000Z'),
      embedding: makeVector([-0.5, -0.5, 0]),
    },
  ];

  for (const post of posts) {
    await runtime.execute(db.post.insert([post]).build());
  }
}

// Seeds polymorphic `Task` rows (Bug / Feature variants) for the admin and
// member users via the ORM client's variant scopes, which auto-inject the
// discriminator and transactionally write the base + variant tables. The
// other seeded users own no tasks, so their included `tasks` come back empty.
// Ids are client-generated (`@default(uuid())`); the created rows are returned
// so the assertions can key on the same ids.
async function seedOrmClientTasks(runtime: Runtime): Promise<SeededTaskIds> {
  const orm = createOrmClient(runtime);

  const adminBug = await orm.Task.bugs().create({
    userId: seededUserIds.admin,
    title: 'Login crashes on Safari',
    severity: 'critical',
    stepsToRepro: 'Open Safari → click "Sign in" → blank white screen',
    createdAt: Temporal.Instant.from('2024-03-01T00:00:00.000Z'),
  });
  const adminFeature = await orm.Task.features().create({
    userId: seededUserIds.admin,
    title: 'Dark mode',
    priority: 'P1',
    targetRelease: 'v2.0',
    createdAt: Temporal.Instant.from('2024-03-02T00:00:00.000Z'),
  });
  const memberBug = await orm.Task.bugs().create({
    userId: seededUserIds.member,
    title: 'Typo on pricing page',
    severity: 'low',
    stepsToRepro: 'Visit /pricing → "recieve" should be "receive"',
    createdAt: Temporal.Instant.from('2024-03-03T00:00:00.000Z'),
  });
  const memberFeature = await orm.Task.features().create({
    userId: seededUserIds.member,
    title: 'Slack integration',
    priority: 'P0',
    targetRelease: 'v2.0',
    createdAt: Temporal.Instant.from('2024-03-04T00:00:00.000Z'),
  });

  return {
    adminBug: adminBug.id,
    adminFeature: adminFeature.id,
    memberBug: memberBug.id,
    memberFeature: memberFeature.id,
  };
}

describe('ORM client integration examples', () => {
  it(
    'ormClientGetUsers returns limited rows',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const users = await ormClientGetUsers(1, runtime);

          expect(users).toHaveLength(1);
          expect(users[0]).toMatchObject({
            id: expect.any(String),
            email: expect.any(String),
            kind: expect.any(String),
          });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetAdminUsers returns only admin rows',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const users = await ormClientGetAdminUsers(10, runtime);

          expect(users).toHaveLength(2);
          expect(users.every((user) => user.kind === 'admin')).toBe(true);
          expect(users.map((user) => user.id).sort()).toEqual([
            seededUserIds.admin,
            seededUserIds.adminTwo,
          ]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientFindUserByEmail returns a matching user and null for unknown email',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const user = await ormClientFindUserByEmail('member@example.com', runtime);
          const missing = await ormClientFindUserByEmail('missing@example.com', runtime);

          expect(user).toMatchObject({
            email: 'member@example.com',
            kind: 'user',
          });
          expect(user!.id).toBe(seededUserIds.member);
          expect(missing).toBeNull();
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientFindUserById uses shorthand first({ id })',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const user = await ormClientFindUserById(seededUserIds.admin, runtime);
          const missing = await ormClientFindUserById(
            '00000000-0000-0000-0000-000000000099',
            runtime,
          );

          expect(user!.id).toBe(seededUserIds.admin);
          expect(missing).toBeNull();
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientCreateUser and ormClientUpdateUserEmail run create()/update() terminal methods',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          const created = await ormClientCreateUser(
            {
              id: '00000000-0000-0000-0000-000000000099',
              email: 'created@example.com',
              displayName: 'Created User',
              kind: 'user',
              createdAt: Temporal.Instant.from('2024-02-01T00:00:00.000Z'),
            },
            runtime,
          );
          const updated = await ormClientUpdateUserEmail(
            '00000000-0000-0000-0000-000000000099',
            'updated@example.com',
            runtime,
          );

          expect(created).toEqual({
            id: '00000000-0000-0000-0000-000000000099',
            email: 'created@example.com',
            kind: 'user',
          });
          expect(updated).toEqual({
            id: '00000000-0000-0000-0000-000000000099',
            email: 'updated@example.com',
            kind: 'user',
          });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientCreateUserWithAddress creates a user with an embedded Address value object',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          const address = {
            street: '789 Elm Blvd',
            city: 'Austin',
            zip: '73301',
            country: 'US',
          };
          const created = await ormClientCreateUserWithAddress(
            {
              id: '00000000-0000-0000-0000-000000000088',
              email: 'addressed@example.com',
              displayName: 'Addressed User',
              kind: 'user',
              createdAt: Temporal.Instant.from('2024-02-01T00:00:00.000Z'),
              address,
            },
            runtime,
          );

          expect(created).toMatchObject({
            id: '00000000-0000-0000-0000-000000000088',
            email: 'addressed@example.com',
            kind: 'user',
            address,
          });

          const fetched = await ormClientGetUsers(10, runtime);
          const found = fetched.find((u) => u.id === '00000000-0000-0000-0000-000000000088');
          expect(found?.address).toEqual(address);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientAggregateUsers computes aggregate() totals',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const aggregates = await ormClientAggregateUsers(runtime);

          expect(aggregates).toEqual({
            totalUsers: 4,
            adminUsers: 2,
          });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetUserPosts returns scoped posts in descending createdAt order',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const posts = await ormClientGetUserPosts(seededUserIds.admin, 10, runtime);

          expect(posts.map((post) => post.id)).toEqual([seededPostIds.newer, seededPostIds.older]);
          expect(posts.every((post) => post.userId === seededUserIds.admin)).toBe(true);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetDashboardUsers composes compound filters with select and include',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const users = await ormClientGetDashboardUsers('example.com', 'post', 10, 1, runtime);

          expect(users.map((user) => user.id)).toEqual([
            seededUserIds.adminTwo,
            seededUserIds.admin,
          ]);
          expect(users.map((user) => user.kind)).toEqual(['admin', 'admin']);
          expect(users.map((user) => user.posts.map((post) => post.id))).toEqual([
            [seededPostIds.adminZebra],
            [seededPostIds.newer],
          ]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetPostFeed returns posts with projected to-one include payloads',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const posts = await ormClientGetPostFeed('post', 3, runtime);

          expect(posts.map((post) => post.id)).toEqual([
            seededPostIds.adminZebra,
            seededPostIds.adminDeepDive,
            seededPostIds.newer,
          ]);
          expect(posts.every((post) => 'embedding' in post === false)).toBe(true);
          expect(posts.map((post) => post.user!.id)).toEqual([
            seededUserIds.adminTwo,
            seededUserIds.adminTwo,
            seededUserIds.admin,
          ]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetUserTaskBoard includes the polymorphic tasks relation in its full default per-variant shape',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const taskIds = await seedOrmClientTasks(runtime);
          const board = await ormClientGetUserTaskBoard(10, runtime);

          // newestFirst() orders users by createdAt desc: reader, adminTwo,
          // member, admin. Only admin and member own tasks. The include takes
          // the default projection, so each task row carries its full default
          // shape — the shared Task columns plus the columns of whichever
          // variant the discriminator selects (Bug: severity/stepsToRepro,
          // Feature: priority/targetRelease) — all from one include.
          expect(board).toEqual([
            { id: seededUserIds.reader, displayName: 'Reader', kind: 'user', tasks: [] },
            { id: seededUserIds.adminTwo, displayName: 'Admin Two', kind: 'admin', tasks: [] },
            {
              id: seededUserIds.member,
              displayName: 'Member',
              kind: 'user',
              tasks: [
                {
                  id: taskIds.memberBug,
                  title: 'Typo on pricing page',
                  description: null,
                  status: 'open',
                  type: 'bug',
                  userId: seededUserIds.member,
                  createdAt: Temporal.Instant.from('2024-03-03T00:00:00.000Z'),
                  severity: 'low',
                  stepsToRepro: 'Visit /pricing → "recieve" should be "receive"',
                },
                {
                  id: taskIds.memberFeature,
                  title: 'Slack integration',
                  description: null,
                  status: 'open',
                  type: 'feature',
                  userId: seededUserIds.member,
                  createdAt: Temporal.Instant.from('2024-03-04T00:00:00.000Z'),
                  priority: 'P0',
                  targetRelease: 'v2.0',
                },
              ],
            },
            {
              id: seededUserIds.admin,
              displayName: 'Admin',
              kind: 'admin',
              tasks: [
                {
                  id: taskIds.adminBug,
                  title: 'Login crashes on Safari',
                  description: null,
                  status: 'open',
                  type: 'bug',
                  userId: seededUserIds.admin,
                  createdAt: Temporal.Instant.from('2024-03-01T00:00:00.000Z'),
                  severity: 'critical',
                  stepsToRepro: 'Open Safari → click "Sign in" → blank white screen',
                },
                {
                  id: taskIds.adminFeature,
                  title: 'Dark mode',
                  description: null,
                  status: 'open',
                  type: 'feature',
                  userId: seededUserIds.admin,
                  createdAt: Temporal.Instant.from('2024-03-02T00:00:00.000Z'),
                  priority: 'P1',
                  targetRelease: 'v2.0',
                },
              ],
            },
          ]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetUserBugTriage narrows the include to Bug, filters by severity, and returns the full default Bug shape',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const taskIds = await seedOrmClientTasks(runtime);
          const triage = await ormClientGetUserBugTriage('critical', 10, runtime);

          // Users ordered by displayName asc; only admin owns a critical bug,
          // and only Bug variant rows survive the variant narrowing. The
          // include takes the default projection, so the surviving row carries
          // its full default Bug shape (shared Task columns + Bug columns).
          expect(triage).toEqual([
            {
              id: seededUserIds.admin,
              displayName: 'Admin',
              tasks: [
                {
                  id: taskIds.adminBug,
                  title: 'Login crashes on Safari',
                  description: null,
                  status: 'open',
                  type: 'bug',
                  userId: seededUserIds.admin,
                  createdAt: Temporal.Instant.from('2024-03-01T00:00:00.000Z'),
                  severity: 'critical',
                  stepsToRepro: 'Open Safari → click "Sign in" → blank white screen',
                },
              ],
            },
            { id: seededUserIds.adminTwo, displayName: 'Admin Two', tasks: [] },
            { id: seededUserIds.member, displayName: 'Member', tasks: [] },
            { id: seededUserIds.reader, displayName: 'Reader', tasks: [] },
          ]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetFeatureRoadmap narrows the include to Feature, filters by targetRelease, and returns the full default Feature shape',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const taskIds = await seedOrmClientTasks(runtime);
          const roadmap = await ormClientGetFeatureRoadmap('v2.0', 10, runtime);

          // Both admin and member have a Feature targeting v2.0; the
          // targetRelease filter reaches a column in the joined `feature`
          // table. The include takes the default projection, so each surviving
          // row carries its full default Feature shape (shared Task columns +
          // Feature columns).
          expect(roadmap).toEqual([
            {
              id: seededUserIds.admin,
              displayName: 'Admin',
              tasks: [
                {
                  id: taskIds.adminFeature,
                  title: 'Dark mode',
                  description: null,
                  status: 'open',
                  type: 'feature',
                  userId: seededUserIds.admin,
                  createdAt: Temporal.Instant.from('2024-03-02T00:00:00.000Z'),
                  priority: 'P1',
                  targetRelease: 'v2.0',
                },
              ],
            },
            { id: seededUserIds.adminTwo, displayName: 'Admin Two', tasks: [] },
            {
              id: seededUserIds.member,
              displayName: 'Member',
              tasks: [
                {
                  id: taskIds.memberFeature,
                  title: 'Slack integration',
                  description: null,
                  status: 'open',
                  type: 'feature',
                  userId: seededUserIds.member,
                  createdAt: Temporal.Instant.from('2024-03-04T00:00:00.000Z'),
                  priority: 'P0',
                  targetRelease: 'v2.0',
                },
              ],
            },
            { id: seededUserIds.reader, displayName: 'Reader', tasks: [] },
          ]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetUsersByIdCursor returns rows after cursor boundary',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const firstPage = await ormClientGetUsersByIdCursor(null, 2, runtime);
          const secondPage = await ormClientGetUsersByIdCursor(seededUserIds.member, 2, runtime);

          expect(firstPage.map((user) => user.id)).toEqual([
            seededUserIds.admin,
            seededUserIds.member,
          ]);
          expect(secondPage.map((user) => user.id)).toEqual([
            seededUserIds.adminTwo,
            seededUserIds.reader,
          ]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetLatestUserPerKind returns one latest row per kind using distinctOn',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const users = await ormClientGetLatestUserPerKind(runtime);

          expect(users).toHaveLength(2);
          expect(users.map((user) => user.id)).toEqual([
            seededUserIds.adminTwo,
            seededUserIds.reader,
          ]);
          expect(users.map((user) => user.kind)).toEqual(['admin', 'user']);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetUserInsights returns per-user counts with latest related post',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const users = await ormClientGetUserInsights(4, runtime);

          expect(users.map((user) => user.id)).toEqual([
            seededUserIds.reader,
            seededUserIds.adminTwo,
            seededUserIds.member,
            seededUserIds.admin,
          ]);

          expect(users.map((user) => user.posts.totalPosts)).toEqual([0, 2, 1, 2]);
          expect(users.map((user) => user.posts.latestPost.map((post) => post.id))).toEqual([
            [],
            [seededPostIds.adminZebra],
            [seededPostIds.memberNote],
            [seededPostIds.newer],
          ]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetUserKindBreakdown returns grouped user counts with having filter',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const atLeastTwo = await ormClientGetUserKindBreakdown(2, runtime);
          const atLeastThree = await ormClientGetUserKindBreakdown(3, runtime);

          expect(atLeastTwo).toEqual([
            { kind: 'admin', totalUsers: 2 },
            { kind: 'user', totalUsers: 2 },
          ]);
          expect(atLeastThree).toEqual([]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientUpsertUser updates existing row and inserts missing row',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const insertedId = '00000000-0000-0000-0000-000000000099';

          const updated = await ormClientUpsertUser(
            {
              id: seededUserIds.admin,
              email: 'admin-upserted@example.com',
              displayName: 'Admin Upserted',
              kind: 'admin',
            },
            runtime,
          );
          const inserted = await ormClientUpsertUser(
            {
              id: insertedId,
              email: 'inserted-upsert@example.com',
              displayName: 'Inserted Upsert',
              kind: 'user',
              createdAt: Temporal.Instant.from('2024-02-01T00:00:00.000Z'),
            },
            runtime,
          );

          expect(updated).toMatchObject({
            id: seededUserIds.admin,
            email: 'admin-upserted@example.com',
            kind: 'admin',
          });
          expect(inserted).toMatchObject({
            id: insertedId,
            email: 'inserted-upsert@example.com',
            kind: 'user',
          });
          expect(inserted.createdAt).toBeTruthy();

          const insertedUser = await ormClientFindUserById(insertedId, runtime);
          expect(insertedUser).toMatchObject({
            id: insertedId,
            email: 'inserted-upsert@example.com',
            kind: 'user',
          });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientDeleteUser removes a user by id',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const before = await ormClientFindUserById(seededUserIds.reader, runtime);
          expect(before).not.toBeNull();

          await ormClientDeleteUser(seededUserIds.reader, runtime);

          const after = await ormClientFindUserById(seededUserIds.reader, runtime);
          expect(after).toBeNull();
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetUsersBackwardCursor returns rows before cursor in descending id order',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);

          const page = await ormClientGetUsersBackwardCursor(seededUserIds.reader, 2, runtime);
          expect(page.map((user) => user.id)).toEqual([
            seededUserIds.adminTwo,
            seededUserIds.member,
          ]);

          const partialPage = await ormClientGetUsersBackwardCursor(
            seededUserIds.member,
            10,
            runtime,
          );
          expect(partialPage.map((user) => user.id)).toEqual([seededUserIds.admin]);

          const emptyPage = await ormClientGetUsersBackwardCursor(seededUserIds.admin, 2, runtime);
          expect(emptyPage).toHaveLength(0);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientFindSimilarPosts returns posts ordered by cosine distance with user include',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          await seedEmbeddingPosts(runtime);
          const results = await ormClientFindSimilarPosts(embeddingPostIds.reference, 10, runtime);

          expect(results.map((r) => r.id)).toEqual([
            embeddingPostIds.similar1,
            embeddingPostIds.similar2,
          ]);
          expect(results.map((r) => r.user!.email)).toEqual([
            'member@example.com',
            'admin2@example.org',
          ]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientSearchPostsByEmbedding returns posts within max cosine distance ordered by similarity',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          await seedEmbeddingPosts(runtime);
          const results = await ormClientSearchPostsByEmbedding(
            makeVector([1, 0, 0]),
            0.5,
            10,
            runtime,
          );

          expect(results.map((r) => r.id)).toEqual([
            embeddingPostIds.reference,
            embeddingPostIds.similar1,
            embeddingPostIds.similar2,
          ]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ---------------------------------------------------------------------------
  // Cache middleware integration tests.
  //
  // The cache helpers under `src/orm-client/find-user-by-id-cached.ts` and
  // `src/orm-client/get-users-cached.ts` opt their reads into the
  // `@internal/middleware-cache` middleware via `cacheAnnotation(...)`.
  // The middleware short-circuits repeated executions of the same plan via
  // its `interceptQuery` hook, so a cache hit means the SQL driver is *not*
  // invoked again. We assert that contract by spying on `driver.query`.
  // ---------------------------------------------------------------------------

  it(
    'ormClientFindUserByIdCached serves the second call from the cache (driver.query not invoked again)',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const cache = createCacheMiddleware({ maxEntries: 100 });
        const { runtime, driver } = await getRuntimeWithMiddleware(connectionString, [cache]);

        try {
          await seedOrmClientData(runtime);

          // Spy *after* seeding so we don't count seed inserts.
          const driverQuerySpy = vi.spyOn(driver, 'query');

          const first = await ormClientFindUserByIdCached(seededUserIds.admin, runtime);
          const driverCallsAfterFirst = driverQuerySpy.mock.calls.length;
          expect(driverCallsAfterFirst).toBeGreaterThan(0);
          expect(first).toMatchObject({ id: seededUserIds.admin, kind: 'admin' });

          const second = await ormClientFindUserByIdCached(seededUserIds.admin, runtime);
          // Cache hit: driver was not invoked again.
          expect(driverQuerySpy.mock.calls.length).toBe(driverCallsAfterFirst);
          expect(second).toEqual(first);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientFindUserByIdCached forceRefresh: true bypasses the cache (skip annotation)',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const cache = createCacheMiddleware({ maxEntries: 100 });
        const { runtime, driver } = await getRuntimeWithMiddleware(connectionString, [cache]);

        try {
          await seedOrmClientData(runtime);
          const driverQuerySpy = vi.spyOn(driver, 'query');

          // Prime the cache.
          await ormClientFindUserByIdCached(seededUserIds.admin, runtime);
          const callsAfterFirst = driverQuerySpy.mock.calls.length;

          // Same query but with skip — should hit the driver again.
          await ormClientFindUserByIdCached(seededUserIds.admin, runtime, {
            forceRefresh: true,
          });
          expect(driverQuerySpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetUsersCached serves the second call from cache; different limits land in distinct slots',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const cache = createCacheMiddleware({ maxEntries: 100 });
        const { runtime, driver } = await getRuntimeWithMiddleware(connectionString, [cache]);

        try {
          await seedOrmClientData(runtime);
          const driverQuerySpy = vi.spyOn(driver, 'query');

          const first = await ormClientGetUsersCached(2, runtime);
          const callsAfterFirst = driverQuerySpy.mock.calls.length;
          expect(first).toHaveLength(2);

          const second = await ormClientGetUsersCached(2, runtime);
          // Same plan: cache hit, driver not invoked.
          expect(driverQuerySpy.mock.calls.length).toBe(callsAfterFirst);
          expect(second).toEqual(first);

          // Different plan (different limit → different params → different
          // identity key): cache miss, driver invoked.
          await ormClientGetUsersCached(3, runtime);
          expect(driverQuerySpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetUsersCached supports an explicit cache key for sharing entries across plans',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const cache = createCacheMiddleware({ maxEntries: 100 });
        const { runtime, driver } = await getRuntimeWithMiddleware(connectionString, [cache]);

        try {
          await seedOrmClientData(runtime);
          const driverQuerySpy = vi.spyOn(driver, 'query');

          // Prime the cache under an explicit key.
          const first = await ormClientGetUsersCached(2, runtime, { key: 'user-list:demo' });
          const callsAfterFirst = driverQuerySpy.mock.calls.length;
          expect(first).toHaveLength(2);

          // Different limit (→ different identity key) but same explicit
          // key: the entry is shared. The cache middleware uses the
          // supplied key verbatim and serves the previously buffered
          // rows even though the underlying SQL has changed. (Two-row
          // rows from the first call — the explicit key takes precedence
          // over the canonical identity key.)
          const second = await ormClientGetUsersCached(5, runtime, { key: 'user-list:demo' });
          expect(driverQuerySpy.mock.calls.length).toBe(callsAfterFirst);
          expect(second).toEqual(first);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
