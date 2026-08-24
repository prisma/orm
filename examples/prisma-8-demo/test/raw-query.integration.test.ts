/**
 * Integration tests for the whole-query raw demos.
 *
 * Each test runs the demo function the CLI command calls, against a real
 * database, so the examples a reader copies are known to execute.
 */

import { sql } from '@prisma/orm-postgres/builder/runtime';
import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import postgres from '@prisma/orm-postgres/runtime';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma/contract';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };
import { db } from '../src/prisma/db';
import {
  rawQueryActiveAuthors,
  rawQueryBumpViews,
  rawQueryPromoteAndList,
  rawQueryReport,
} from '../src/queries/raw-query-demo';
import { initTestDatabase } from './utils/control-client';

const context = db.context;
const { contract } = context;

async function getRuntime(connectionString: string): Promise<Runtime> {
  const client = postgres<Contract>({
    contractJson,
    url: connectionString,
    extensions: db.stack.extensions,
  });
  return client.connect();
}

const userIds = {
  ada: '50000000-0000-0000-0000-000000000001',
  grace: '50000000-0000-0000-0000-000000000002',
  linus: '50000000-0000-0000-0000-000000000003',
} as const;

const postIds = {
  adaFirst: '60000000-0000-0000-0000-000000000001',
  adaSecond: '60000000-0000-0000-0000-000000000002',
  graceOnly: '60000000-0000-0000-0000-000000000003',
} as const;

async function seed(runtime: Runtime): Promise<void> {
  const builder = sql({ context, rawCodecInferer: { inferCodec: () => 'pg/text@1' } }).public;

  const users = [
    {
      id: userIds.ada,
      email: 'ada@example.com',
      displayName: 'Ada',
      createdAt: Temporal.Instant.from('2024-05-01T00:00:00.000Z'),
      kind: 'admin' as const,
    },
    {
      id: userIds.grace,
      email: 'grace@example.com',
      displayName: 'Grace',
      createdAt: Temporal.Instant.from('2024-05-02T00:00:00.000Z'),
      kind: 'admin' as const,
    },
    {
      id: userIds.linus,
      email: 'linus@example.com',
      displayName: 'Linus',
      createdAt: Temporal.Instant.from('2024-05-03T00:00:00.000Z'),
      kind: 'user' as const,
    },
  ];
  for (const user of users) {
    await runtime.execute(builder.user.insert([user]).build());
  }

  const posts = [
    {
      id: postIds.adaFirst,
      title: 'Analytical engine notes',
      userId: userIds.ada,
      priority: db.enums.public.Priority.members.Low,
      createdAt: Temporal.Instant.from('2024-05-10T10:00:00.000Z'),
      viewCount: 10,
    },
    {
      id: postIds.adaSecond,
      title: 'Bernoulli numbers',
      userId: userIds.ada,
      priority: db.enums.public.Priority.members.Low,
      createdAt: Temporal.Instant.from('2024-05-11T10:00:00.000Z'),
      viewCount: 20,
    },
    {
      id: postIds.graceOnly,
      title: 'Compiler design',
      userId: userIds.grace,
      priority: db.enums.public.Priority.members.Low,
      createdAt: Temporal.Instant.from('2024-05-12T10:00:00.000Z'),
      viewCount: 30,
    },
  ];
  for (const post of posts) {
    await runtime.execute(builder.post.insert([post]).build());
  }
}

describe('whole-query raw demos', () => {
  it(
    'rawQueryReport decodes contract columns and a computed count',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);
        try {
          await seed(runtime);

          const rows = await rawQueryReport(10, runtime);

          expect(rows).toEqual([
            { id: userIds.ada, email: 'ada@example.com', postCount: 2n },
            { id: userIds.grace, email: 'grace@example.com', postCount: 1n },
            { id: userIds.linus, email: 'linus@example.com', postCount: 0n },
          ]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'rawQueryBumpViews reports how many rows the mutation touched',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);
        try {
          await seed(runtime);

          const stats = await rawQueryBumpViews('admin', runtime);

          // Ada has two posts and Grace one; Linus is not an admin.
          expect(stats).toEqual({ affectedRows: 3 });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'rawQueryActiveAuthors composes a CTE from an interpolated raw query',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);
        try {
          await seed(runtime);

          const rows = await rawQueryActiveAuthors(2, runtime);

          // Only Ada clears the two-post threshold the inner query binds.
          expect(rows).toEqual([{ email: 'ada@example.com', postCount: 2n }]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'rawQueryPromoteAndList composes a data-modifying CTE',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);
        try {
          await seed(runtime);

          const rows = await rawQueryPromoteAndList('numbers', runtime);

          expect(rows).toEqual([{ title: 'Bernoulli numbers', email: 'ada@example.com' }]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
