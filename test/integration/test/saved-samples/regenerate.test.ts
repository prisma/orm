/**
 * Writes a new saved sample set with this branch's code. It runs only when `REGENERATE_SAVED_SAMPLES` names the release, and never replaces a set that exists; the procedure is in this folder's README.
 */

import { cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  injectMigrationSqlDbSetup,
  type JourneyContext,
  latestMigrationDirName,
  latestMigrationToHash,
  runContractEmit,
  runMigrate,
  runMigrationPlan,
  runRef,
  selfEmitMigration,
} from '../utils/journey-test-helpers';
import {
  emptySampleProject,
  type SampleDatabase,
  sampleDatabaseDir,
  sampleProjectDir,
  sampleSetExists,
  saveMongoRecords,
  savePostgresRecords,
} from './sample-projects';

/** The release the new set is written for: the version that will ship this branch's code, which can be later than the root `package.json` version until the release is cut. */
const release = process.env['REGENERATE_SAVED_SAMPLES'] ?? '';

/** The project files a release writes, and the contract source the user wrote; the config and manifest are left out. */
function saveProjectFiles(ctx: JourneyContext, database: SampleDatabase): void {
  const kept = new Set([
    'contract.prisma',
    'contract.json',
    'contract.d.ts',
    'output',
    'migrations',
  ]);
  for (const entry of readdirSync(ctx.testDir)) {
    if (kept.has(entry)) {
      cpSync(join(ctx.testDir, entry), join(sampleProjectDir(release, database), entry), {
        recursive: true,
      });
    }
  }
}

async function emitAndPlan(
  ctx: JourneyContext,
  source: string,
  name: string,
  statements: readonly string[] = [],
): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), source);
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `contract emit for ${name}: ${emit.stderr}`).toBe(0);
  const plan = await runMigrationPlan(ctx, ['--name', name, ...statements]);
  expect(plan.exitCode, `migration plan ${name}: ${plan.stdout}\n${plan.stderr}`).toBe(0);
}

async function migrate(ctx: JourneyContext): Promise<void> {
  const migrated = await runMigrate(ctx);
  expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
}

async function setProductionRef(ctx: JourneyContext): Promise<void> {
  const ref = await runRef(ctx, ['set', 'production', latestMigrationToHash(ctx)]);
  expect(ref.exitCode, `migration ref set: ${ref.stderr}`).toBe(0);
}

const postgresSources = {
  initial: `// use prisma-8

types {
  Embedding3 = pgvector.Vector(3)
}

enum Role {
  @@type("pg/text@1")
  USER
  ADMIN
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  role  Role

  @@map("user")
}

model Document {
  id        Int         @id @default(autoincrement())
  title     String
  embedding Embedding3?

  @@map("document")
}
`,
  posts: `// use prisma-8

types {
  Embedding3 = pgvector.Vector(3)
}

enum Role {
  @@type("pg/text@1")
  USER
  ADMIN
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  role  Role
  posts Post[]

  @@map("user")
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  authorId Int
  author   User   @relation(fields: [authorId], references: [id])

  @@index([authorId])
  @@map("post")
}

model Document {
  id        Int         @id @default(autoincrement())
  title     String
  embedding Embedding3?

  @@map("document")
}
`,
};

const postgresDisplayName = postgresSources.posts.replace(
  '  role  Role\n  posts Post[]',
  '  role  Role\n  displayName String\n  posts Post[]',
);

async function generatePostgres(createTempDir: () => string): Promise<void> {
  const database = await createDevDatabase();
  try {
    const ctx = emptySampleProject(createTempDir(), 'postgres', database.connectionString);
    await emitAndPlan(ctx, postgresSources.initial, 'initial');
    await migrate(ctx);
    await emitAndPlan(ctx, postgresSources.posts, 'add-posts');
    await migrate(ctx);
    await emitAndPlan(ctx, postgresDisplayName, 'add-display-name', [
      '--backfill',
      'User.displayName',
    ]);

    const dataMigrationDir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
    const migrationTs = join(dataMigrationDir, 'migration.ts');
    writeFileSync(
      migrationTs,
      injectMigrationSqlDbSetup(readFileSync(migrationTs, 'utf8'))
        .replace(
          'createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter })',
          'createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter, extensions: [pgvector] })',
        )
        .replace(
          "import postgresTarget from '@internal/target-postgres/runtime';",
          "import postgresTarget from '@internal/target-postgres/runtime';\nimport pgvector from '@internal/extension-pgvector/runtime';",
        )
        .replace(
          "() => placeholder('User.displayName:check')",
          "() => db.public.user.select('id').where((f, fns) => fns.eq(f.displayName, null)).limit(1)",
        )
        .replace(
          "() => placeholder('User.displayName:run')",
          "() => db.public.user.update({ displayName: 'unnamed' }).where((f, fns) => fns.eq(f.displayName, null))",
        ),
    );
    const selfEmit = await selfEmitMigration(ctx, [
      '--dir',
      dataMigrationDir,
      '--config',
      ctx.configPath,
    ]);
    expect(selfEmit.exitCode, `node migration.ts: ${selfEmit.stdout}\n${selfEmit.stderr}`).toBe(0);

    await migrate(ctx);
    await setProductionRef(ctx);

    saveProjectFiles(ctx, 'postgres');
    await savePostgresRecords(database.connectionString, sampleDatabaseDir(release, 'postgres'));
  } finally {
    await database.close();
  }
}

const mongoSources = {
  initial: `// use prisma-8

enum Role {
  USER
  ADMIN
}

model User {
  id    ObjectId @id @map("_id")
  email String   @unique
  role  Role

  @@map("users")
}
`,
};

const mongoPosts = mongoSources.initial
  .replace('  role  Role\n', '  role  Role\n  posts Post[]\n')
  .concat(`
model Post {
  id       ObjectId @id @map("_id")
  title    String
  authorId ObjectId
  author   User     @relation(fields: [authorId], references: [id])

  @@index([authorId])
  @@map("posts")
}
`);

const mongoName = mongoPosts.replace('  role  Role\n', '  role  Role\n  name  String?\n');

async function generateMongo(createTempDir: () => string): Promise<void> {
  const replSet = await MongoMemoryReplSet.create({
    instanceOpts: [
      { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
    ],
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const client = new MongoClient(replSet.getUri());
  try {
    await client.connect();
    const dbName = 'saved_samples';
    const ctx = emptySampleProject(createTempDir(), 'mongo', replSet.getUri(dbName));
    await emitAndPlan(ctx, mongoSources.initial, 'initial');
    await migrate(ctx);
    await emitAndPlan(ctx, mongoPosts, 'add-posts');
    await migrate(ctx);
    await emitAndPlan(ctx, mongoName, 'add-name');
    await migrate(ctx);
    await setProductionRef(ctx);

    saveProjectFiles(ctx, 'mongo');
    await saveMongoRecords(client.db(dbName), sampleDatabaseDir(release, 'mongo'));
  } finally {
    await client.close();
    await replSet.stop();
  }
}

withTempDir(({ createTempDir }) => {
  describe.runIf(release !== '')(`saved sample set for ${release}`, () => {
    it.each(['postgres', 'mongo'] as const)(
      'is written for %s',
      async (database) => {
        if (sampleSetExists(release, database)) {
          throw new Error(
            `A ${database} sample set for ${release} exists. A released set is never edited; delete it first only if ${release} has not been released.`,
          );
        }
        if (database === 'postgres') await generatePostgres(createTempDir);
        else await generateMongo(createTempDir);
      },
      timeouts.spinUpPpgDev + timeouts.spinUpMongoMemoryServer,
    );
  });
});
