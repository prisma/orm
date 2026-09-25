/**
 * The user-facing journey for the Prisma 6 MongoDB contract source: a project
 * whose `prisma.config.ts` points `defineConfig` from the Mongo config entry at
 * `prisma6Schema('./schema.prisma')` runs `contract emit`, `db sign`, and
 * `db verify` through the real command family against a database laid out the
 * way Prisma 6 `db push` lays it out: a collection per model, no validators,
 * and indexes under Prisma 6's names. Verify reports zero findings in both
 * modes, since it matches indexes by keys and options, not by name. An index
 * the contract does not declare is a warning in lenient mode and an issue in
 * strict mode.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runDbSign,
  runDbVerify,
} from '../utils/journey-test-helpers';

const JOURNEY_FIXTURES = join(
  __dirname,
  '../fixtures/cli/cli-e2e-test-app/fixtures/mongo-cli-journeys',
);

/** Splices the database name into the replica set URI, keeping its query. */
function buildMongoUri(baseUri: string, dbName: string): string {
  const [hostPart, query] = baseUri.split('?');
  const trimmedHost = (hostPart ?? '').replace(/\/?$/, '/');
  return query ? `${trimmedHost}${dbName}?${query}` : `${trimmedHost}${dbName}`;
}

/** What Prisma 6 `db push` creates for `prisma6-schema.prisma`. */
async function pushLikePrisma6(db: Db): Promise<void> {
  await db.createCollection('User');
  await db.collection('User').createIndex({ email: 1 }, { unique: true, name: 'User_email_key' });
  await db.createCollection('Post');
  await db.collection('Post').createIndex({ authorId: 1 }, { name: 'Post_authorId_idx' });
}

function setupPrisma6Project(
  createTempDir: () => string,
  connectionString: string,
): JourneyContext {
  const testDir = createTempDir();
  writeProjectManifest(testDir);
  mkdirSync(join(testDir, 'migrations'), { recursive: true });
  copyFileSync(join(JOURNEY_FIXTURES, 'prisma6-schema.prisma'), join(testDir, 'schema.prisma'));
  const config = readFileSync(join(JOURNEY_FIXTURES, 'prisma.config.prisma6.ts'), 'utf-8').replace(
    /\{\{DB_URL\}\}/g,
    () => connectionString,
  );
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(configPath, config, 'utf-8');
  return { testDir, configPath, outputDir: testDir };
}

function output(run: { readonly stdout: string; readonly stderr: string }): string {
  return `${stripAnsi(run.stderr)}\n${stripAnsi(run.stdout)}`;
}

interface EmittedContract {
  readonly storage: {
    readonly namespaces: Record<
      string,
      { readonly entries: { readonly collection: Record<string, Record<string, unknown>> } }
    >;
  };
  readonly execution: {
    readonly mutations: {
      readonly defaults: readonly {
        readonly ref: { readonly entry: string; readonly field: string };
        readonly onCreate?: unknown;
        readonly onUpdate?: unknown;
      }[];
    };
  };
}

withTempDir(({ createTempDir }) => {
  describe('Journey: Prisma 6 MongoDB schema as the contract source', {
    timeout: timeouts.spinUpMongoMemoryServer,
  }, () => {
    let replSet: MongoMemoryReplSet;
    let client: MongoClient;
    const dbName = 'prisma6_source_journey';

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({
        instanceOpts: [
          { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
        ],
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      client = new MongoClient(replSet.getUri());
      await client.connect();
    }, timeouts.spinUpMongoMemoryServer);

    beforeEach(async () => {
      await client.db(dbName).dropDatabase();
      await pushLikePrisma6(client.db(dbName));
    });

    afterAll(async () => {
      await client?.close().catch(() => {});
      await replSet?.stop().catch(() => {});
    }, timeouts.spinUpMongoMemoryServer);

    async function emitAndSign(): Promise<JourneyContext> {
      const ctx = setupPrisma6Project(createTempDir, buildMongoUri(replSet.getUri(), dbName));
      const emit = await runContractEmit(ctx, ['--json']);
      expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
      const sign = await runDbSign(ctx, ['--json']);
      expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);
      return ctx;
    }

    it('contract emit, db sign, and db verify succeed against the database Prisma 6 built', async () => {
      const ctx = await emitAndSign();

      const contractJsonPath = join(ctx.testDir, 'contract.json');
      expect(existsSync(contractJsonPath)).toBe(true);
      expect(existsSync(join(ctx.testDir, 'contract.d.ts'))).toBe(true);
      const contract = JSON.parse(readFileSync(contractJsonPath, 'utf-8')) as EmittedContract;
      const collections = contract.storage.namespaces['__unbound__']?.entries.collection;
      expect(collections).toEqual({
        User: {
          kind: 'mongo-collection',
          indexes: [
            expect.objectContaining({ keys: [{ field: 'email', direction: 1 }], unique: true }),
          ],
        },
        Post: {
          kind: 'mongo-collection',
          indexes: [expect.objectContaining({ keys: [{ field: 'authorId', direction: 1 }] })],
        },
      });
      expect(
        contract.execution.mutations.defaults.map(({ ref, onCreate, onUpdate }) => ({
          field: `${ref.entry}.${ref.field}`,
          onCreate: onCreate !== undefined,
          onUpdate: onUpdate !== undefined,
        })),
      ).toEqual([
        { field: 'Post.createdAt', onCreate: true, onUpdate: false },
        { field: 'Post.updatedAt', onCreate: true, onUpdate: true },
      ]);

      const verify = await runDbVerify(ctx, ['--json']);
      expect(verify.exitCode, `db verify\n${output(verify)}`).toBe(0);
      expect(verify.presented?.data).toMatchObject({
        ok: true,
        mode: 'full',
        schema: { strict: false, warnings: [] },
        unclaimed: [],
      });

      const strictVerify = await runDbVerify(ctx, ['--json', '--strict']);
      expect(strictVerify.exitCode, `db verify --strict\n${output(strictVerify)}`).toBe(0);
      expect(strictVerify.presented?.data).toMatchObject({
        ok: true,
        schema: { strict: true, warnings: [] },
        unclaimed: [],
      });
    });

    it('an index the contract does not declare is a warning, and an issue under --strict', async () => {
      const ctx = await emitAndSign();
      await client
        .db(dbName)
        .collection('User')
        .createIndex({ legacy: 1 }, { unique: true, name: 'User_legacy_key' });

      const verify = await runDbVerify(ctx, ['--json']);
      expect(verify.exitCode, `db verify\n${output(verify)}`).toBe(0);
      expect(verify.presented?.data).toMatchObject({
        ok: true,
        schema: { strict: false, warnings: ['User/index:legacy:1'] },
      });

      const strictVerify = await runDbVerify(ctx, ['--json', '--strict']);
      expect(strictVerify.exitCode, `db verify --strict\n${output(strictVerify)}`).toBe(4);
      expect(strictVerify.presented?.data).toMatchObject({
        ok: false,
        code: 'CONTRACT.SCHEMA_VERIFICATION_FAILED',
        schema: { issues: [{ path: ['User', 'index:legacy:1'] }] },
      });
    });
  });
});
