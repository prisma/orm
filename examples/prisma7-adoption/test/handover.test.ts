/**
 * Prisma 8 takes over migrations from the Prisma 7 schema. On a database
 * Prisma 7 built, Prisma 8 signs, then plans and applies three edits made to
 * `prisma/schema.prisma` in the Prisma 7 dialect: an additive one, a
 * destructive one, and one that gives an existing column an autoincrement
 * default and names a foreign key with `map`. Then it marks a field `@ignore`
 * and a model `@@ignore`, and removes them again; neither edit changes the
 * storage hash or plans a migration. After each, `db verify --strict`
 * passes with nothing unclaimed, Prisma 7 sees no drift,
 * and the clients read the new shape. Finally the migrations replay onto an
 * empty database, which verifies strictly with nothing unclaimed and has the
 * same primary key and foreign key names as the database Prisma 7 built.
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { basename, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  copyExample,
  readContract,
  resultEnvelope,
  run,
  runAllowingFailure,
  verifyHasNoFindings,
} from './story';

interface Operation {
  readonly id: string;
  readonly operationClass: string;
  readonly execute: readonly { readonly sql: string }[];
}

interface Bundle {
  readonly from: string | null;
  readonly to: string;
  readonly operations: readonly Operation[];
}

function readBundle(dir: string, bundleDir: string): Bundle {
  const manifest = JSON.parse(readFileSync(join(dir, bundleDir, 'migration.json'), 'utf-8'));
  const operations = JSON.parse(readFileSync(join(dir, bundleDir, 'ops.json'), 'utf-8'));
  return { from: manifest.from, to: manifest.to, operations };
}

function operationClasses(bundle: Bundle): readonly (readonly [string, string])[] {
  return bundle.operations.map((operation) => [operation.id, operation.operationClass] as const);
}

function renderedSql(bundle: Bundle): string {
  return bundle.operations
    .flatMap((operation) => operation.execute.map((step) => step.sql.replace(/\s+/g, ' ')))
    .join(';\n');
}

function storageHash(dir: string): string {
  return JSON.parse(readContract(dir)).storage.storageHash;
}

/** Every primary key and foreign key in the public schema, by table, kind and name, leaving out Prisma 7's ledger. */
function constraintNames(connectionString: string): Promise<readonly string[]> {
  return withClient(connectionString, async (client) => {
    const result = await client.query<{ table: string; kind: string; name: string }>(
      `SELECT t.relname AS table, c.contype AS kind, c.conname AS name
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public' AND c.contype IN ('p', 'f') AND t.relname <> '_prisma_migrations'
       ORDER BY t.relname, c.contype, c.conname`,
    );
    return result.rows.map(
      (row) => `${row.table} ${row.kind === 'p' ? 'primary key' : 'foreign key'} ${row.name}`,
    );
  });
}

function dbRefHash(dir: string): string {
  return JSON.parse(readFileSync(join(dir, 'migrations/app/refs/db.json'), 'utf-8')).hash;
}

const SEQUENCE_PLAN_OPERATIONS = [
  ['setDefault.Post.viewCount', 'widening'],
  ['foreignKey.public.Post.Post_authorId_fkey.rename', 'widening'],
];

describe('Prisma 8 taking over migrations from the Prisma 7 schema', () => {
  it(
    'plans, applies and verifies an additive and a destructive edit that both clients read',
    async () => {
      const dir = copyExample(['tsconfig.json', 'test/handover']);
      try {
        await withDevDatabase(async ({ connectionString }) => {
          writeFileSync(join(dir, '.env'), `DATABASE_URL=${connectionString}\n`);
          const v7 = (...args: string[]) =>
            run(dir, connectionString, 'prisma7', [...args, '--config', 'prisma7.config.ts']);
          const v8 = async (...args: string[]) =>
            resultEnvelope(await run(dir, connectionString, 'prisma', args)).result;
          const tsx = (script: string) => run(dir, connectionString, 'tsx', [script]);
          const typecheck = (tsconfig: string) =>
            run(dir, connectionString, 'tsc', ['--noEmit', '-p', `test/handover/${tsconfig}`]);

          const editSchema = (fixture: string) =>
            cpSync(join(dir, 'test/handover', fixture), join(dir, 'prisma/schema.prisma'));

          const migrate = async () => {
            const result = await v8('db', 'migrate', '--advance-ref', 'db');
            expect(result).toMatchObject({
              ok: true,
              migrationsApplied: 1,
              markerHash: storageHash(dir),
              advancedRef: { name: 'db', hash: storageHash(dir) },
            });
            expect(dbRefHash(dir)).toBe(storageHash(dir));
          };

          const verifyStrictlyWithNothingUnclaimed = async () => {
            const strict = await runAllowingFailure(dir, connectionString, 'prisma', [
              'db',
              'verify',
              '--strict',
              '--json',
            ]);
            expect(strict.status, strict.output).toBe(0);
            expect(resultEnvelope(strict.output).result).toMatchObject({ ok: true, unclaimed: [] });
            await verifyHasNoFindings(dir, connectionString);
            expect(
              await v7(
                'migrate',
                'diff',
                '--from-config-datasource',
                '--to-schema',
                'prisma/schema.prisma',
                '--script',
              ),
            ).toContain('-- This is an empty migration.');
          };

          const deployed = await v7('migrate', 'deploy');
          expect(deployed).toContain('20260914000000_init');
          expect(deployed).toContain('20260914000100_add_post_view_count');
          await v8('contract', 'emit');
          await v8('db', 'sign');
          await verifyHasNoFindings(dir, connectionString);
          const signedHash = dbRefHash(dir);
          expect(signedHash).toBe(storageHash(dir));
          await v7('generate');
          expect(await tsx('scripts/seed.ts')).toContain(
            'Seeded through Prisma 7: 2 users, 2 posts.',
          );

          editSchema('edit-1.prisma');
          await v8('contract', 'emit');
          const additiveHash = storageHash(dir);
          const additivePlan = await v8('migration', 'plan', '--name', 'add-comments');
          expect(additivePlan).toMatchObject({ from: signedHash, to: additiveHash });
          const baseline = readBundle(dir, String(additivePlan['baselineDir']));
          expect(baseline).toMatchObject({ from: null, to: signedHash });
          expect(operationClasses(baseline)).toEqual([
            ['schema.public', 'additive'],
            ['createNativeEnumType.Role', 'additive'],
            ['table.Post', 'additive'],
            ['table.Tag', 'additive'],
            ['table.User', 'additive'],
            ['table._PostToTag', 'additive'],
            ['index.Tag.Tag_name_key', 'additive'],
            ['index.User.User_email_key', 'additive'],
            ['index._PostToTag._PostToTag_B_index', 'additive'],
            ['foreignKey.Post.Post_authorId_fkey', 'additive'],
            ['foreignKey._PostToTag._PostToTag_A_fkey', 'additive'],
            ['foreignKey._PostToTag._PostToTag_B_fkey', 'additive'],
          ]);
          expect(renderedSql(baseline)).toContain('CONSTRAINT "_PostToTag_AB_pkey" PRIMARY KEY');
          const bundleNames = [additivePlan['baselineDir'], additivePlan['dir']].map((bundleDir) =>
            basename(String(bundleDir)),
          );
          expect([...bundleNames].sort()).toEqual(bundleNames);
          const additive = readBundle(dir, String(additivePlan['dir']));
          expect(additive).toMatchObject({ from: signedHash, to: additiveHash });
          expect(operationClasses(additive)).toEqual([
            ['table.Comment', 'additive'],
            ['column.public.Post.likes', 'additive'],
            ['column.public.User.bio', 'additive'],
            ['index.Post.Post_authorId_idx', 'additive'],
            ['foreignKey.Comment.Comment_postId_fkey', 'additive'],
          ]);
          const additiveSql = renderedSql(additive);
          expect(additiveSql).toContain('ALTER TABLE "public"."User" ADD COLUMN "bio" text');
          expect(additiveSql).toContain(
            'ALTER TABLE "public"."Post" ADD COLUMN "likes" int4 DEFAULT 0 NOT NULL',
          );
          expect(additiveSql).toContain(
            'CREATE INDEX "Post_authorId_idx" ON "public"."Post" ("authorId")',
          );
          expect(additiveSql).toContain(
            'ALTER TABLE "public"."Comment" ADD CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."Post" ("id") ON DELETE RESTRICT ON UPDATE CASCADE',
          );
          await migrate();
          await verifyStrictlyWithNothingUnclaimed();
          await v7('generate');
          await typecheck('tsconfig.edit-1.json');
          const v7Additive = await tsx('test/handover/v7-after-edit-1.ts');
          expect(v7Additive).toContain(
            'bob@example.com bio: Written through Prisma 7 via Prisma 7',
          );
          expect(v7Additive).toContain('Adopting Prisma 8 next to Prisma 7: 3 likes via Prisma 7');
          expect(v7Additive).toContain('comment: Commented through Prisma 7 via Prisma 7');
          const v8Additive = await tsx('test/handover/v8-after-edit-1.ts');
          expect(v8Additive).toContain('alice@example.com bio: (none) via Prisma 8');
          expect(v8Additive).toContain(
            'bob@example.com bio: Written through Prisma 7 via Prisma 8',
          );
          expect(v8Additive).toContain(
            'Adopting Prisma 8 next to Prisma 7: 3 likes, comment: Commented through Prisma 7 via Prisma 8',
          );

          editSchema('edit-2.prisma');
          await v8('contract', 'emit');
          const destructiveHash = storageHash(dir);
          const refused = await runAllowingFailure(dir, connectionString, 'prisma', [
            'migration',
            'plan',
            '--name',
            'drop-bio',
          ]);
          expect(refused.status, refused.output).toBe(2);
          expect(resultEnvelope(refused.output)).toMatchObject({
            ok: false,
            error: {
              code: 'CLI.CONSENT_REQUIRED',
              nextActions: expect.arrayContaining([
                expect.objectContaining({ label: 'Run the command again with --delete User.bio' }),
              ]),
            },
          });
          const destructivePlan = await v8(
            'migration',
            'plan',
            '--name',
            'drop-bio',
            '--delete',
            'User.bio',
          );
          expect(destructivePlan).toMatchObject({ from: additiveHash, to: destructiveHash });
          expect(destructivePlan['baselineDir']).toBeUndefined();
          const destructive = readBundle(dir, String(destructivePlan['dir']));
          expect(destructive).toMatchObject({ from: additiveHash, to: destructiveHash });
          expect(operationClasses(destructive)).toEqual([
            ['dropDefault.Post.likes', 'widening'],
            ['dropColumn.User.bio', 'destructive'],
            ['alterNullability.dropNotNull.Post.likes', 'widening'],
          ]);
          const destructiveSql = renderedSql(destructive);
          expect(destructiveSql).toContain('ALTER TABLE "public"."User" DROP COLUMN "bio"');
          expect(destructiveSql).toContain(
            'ALTER TABLE "public"."Post" ALTER COLUMN "likes" DROP DEFAULT',
          );
          expect(destructiveSql).toContain(
            'ALTER TABLE "public"."Post" ALTER COLUMN "likes" DROP NOT NULL',
          );
          await migrate();
          await verifyStrictlyWithNothingUnclaimed();
          await v7('generate');
          await typecheck('tsconfig.edit-2.json');
          const v7Destructive = await tsx('test/handover/v7-after-edit-2.ts');
          expect(v7Destructive).toContain(
            'Adopting Prisma 8 next to Prisma 7: 3 likes via Prisma 7',
          );
          expect(v7Destructive).toContain('comment: Commented through Prisma 7 via Prisma 7');
          expect(v7Destructive).toContain('likes cleared to null via Prisma 7');
          expect(v7Destructive).toContain('viewCount set to 41 via Prisma 7');
          expect(v7Destructive).toContain(
            'bob@example.com columns: createdAt, email, id, name, role, updatedAt',
          );
          const v8Destructive = await tsx('test/handover/v8-after-edit-2.ts');
          expect(v8Destructive).toContain(
            'Adopting Prisma 8 next to Prisma 7: likes null via Prisma 8',
          );
          expect(v8Destructive).toContain('Draft: what changes at cutover: likes 0 via Prisma 8');

          editSchema('edit-3.prisma');
          await v8('contract', 'emit');
          const sequenceHash = storageHash(dir);
          const sequencePlan = await v8('migration', 'plan', '--name', 'number-posts');
          expect(sequencePlan).toMatchObject({ from: destructiveHash, to: sequenceHash });
          const sequenced = readBundle(dir, String(sequencePlan['dir']));
          expect(sequenced).toMatchObject({ from: destructiveHash, to: sequenceHash });
          expect(operationClasses(sequenced)).toEqual(SEQUENCE_PLAN_OPERATIONS);
          expect(
            sequenced.operations
              .find((operation) => operation.id === 'setDefault.Post.viewCount')
              ?.execute.map((step) => step.sql),
          ).toEqual([
            'ALTER SEQUENCE IF EXISTS "public"."Post_viewCount_seq" AS integer',
            'CREATE SEQUENCE IF NOT EXISTS "public"."Post_viewCount_seq" AS integer',
            `ALTER TABLE "public"."Post" ALTER COLUMN "viewCount" SET DEFAULT nextval('"public"."Post_viewCount_seq"'::regclass)`,
            'ALTER SEQUENCE "public"."Post_viewCount_seq" OWNED BY "public"."Post"."viewCount"',
            `SELECT setval('"public"."Post_viewCount_seq"'::regclass, GREATEST(COALESCE(MAX("viewCount"), 0), 0) + 1, false) FROM "public"."Post"`,
          ]);
          expect(renderedSql(sequenced).match(/RENAME CONSTRAINT/g)).toHaveLength(1);
          expect(renderedSql(sequenced)).toContain(
            'ALTER TABLE "public"."Post" RENAME CONSTRAINT "Post_authorId_fkey" TO "Post_author_fk"',
          );
          await migrate();
          await verifyStrictlyWithNothingUnclaimed();
          expect(await constraintNames(connectionString)).toContain(
            'Post foreign key Post_author_fk',
          );
          await v7('generate');
          await typecheck('tsconfig.edit-3.json');
          const v7Sequenced = await tsx('test/handover/v7-after-edit-3.ts');
          expect(v7Sequenced).toContain('largest viewCount before: 41');
          expect(v7Sequenced).toContain('Numbered by the sequence: viewCount 42 via Prisma 7');

          const expectNoChanges = async (fixture: string, name: string) => {
            editSchema(fixture);
            await v8('contract', 'emit');
            expect(storageHash(dir)).toBe(sequenceHash);
            expect(await v8('migration', 'plan', '--name', name)).toMatchObject({
              ok: true,
              noOp: true,
              from: sequenceHash,
              to: sequenceHash,
              operations: [],
            });
            await verifyStrictlyWithNothingUnclaimed();
          };
          await expectNoChanges('edit-4.prisma', 'ignore-content-and-comments');
          await expectNoChanges('edit-3.prisma', 'restore-content-and-comments');

          await withDevDatabase(async ({ connectionString: freshUrl }) => {
            const replayed = resultEnvelope(
              await run(dir, freshUrl, 'prisma', ['db', 'migrate']),
            ).result;
            expect(replayed).toMatchObject({
              ok: true,
              migrationsApplied: 4,
              markerHash: sequenceHash,
            });
            expect(await constraintNames(freshUrl)).toEqual(
              await constraintNames(connectionString),
            );
            const strict = await runAllowingFailure(dir, freshUrl, 'prisma', [
              'db',
              'verify',
              '--strict',
              '--json',
            ]);
            expect(strict.status, strict.output).toBe(0);
            expect(resultEnvelope(strict.output).result).toMatchObject({ ok: true, unclaimed: [] });
          });
          expect(dbRefHash(dir)).toBe(sequenceHash);
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    timeouts.spinUpPpgDev * 8 + timeouts.typeScriptCompilation * 3,
  );
});
