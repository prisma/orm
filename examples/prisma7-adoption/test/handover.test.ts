/**
 * Prisma 8 takes over migrations from the Prisma 7 schema. On a database
 * Prisma 7 built, Prisma 8 signs, then plans and applies two edits made to
 * `prisma/schema.prisma` in the Prisma 7 dialect: an additive one and a
 * destructive one. After each, `db verify --strict` reports only Prisma 7's
 * ledger table as unclaimed, Prisma 7 sees no drift, and both clients read
 * the new shape.
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
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

function dbRefHash(dir: string): string {
  return JSON.parse(readFileSync(join(dir, 'migrations/app/refs/db.json'), 'utf-8')).hash;
}

describe('Prisma 8 taking over migrations from the Prisma 7 schema', () => {
  it(
    'plans, applies and verifies an additive and a destructive edit that both clients read',
    async () => {
      const dir = copyExample();
      try {
        await withDevDatabase(async ({ connectionString }) => {
          writeFileSync(join(dir, '.env'), `DATABASE_URL=${connectionString}\n`);
          const v7 = (...args: string[]) =>
            run(dir, connectionString, 'prisma7', [...args, '--config', 'prisma7.config.ts']);
          const v8 = async (...args: string[]) =>
            resultEnvelope(await run(dir, connectionString, 'prisma', args)).result;
          const tsx = (script: string) => run(dir, connectionString, 'tsx', [script]);

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

          const verifyOnlyLedgerUnclaimed = async () => {
            const strict = await runAllowingFailure(dir, connectionString, 'prisma', [
              'db',
              'verify',
              '--strict',
              '--json',
            ]);
            expect(strict.status, strict.output).toBe(4);
            expect(resultEnvelope(strict.output).result).toMatchObject({
              ok: false,
              unclaimed: ['_prisma_migrations'],
              schema: { issues: [], warnings: { issues: [] } },
            });
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
          expect(baseline.operations.every((op) => op.operationClass === 'additive')).toBe(true);
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
          await verifyOnlyLedgerUnclaimed();
          await v7('generate');
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
          const destructivePlan = await v8('migration', 'plan', '--name', 'drop-bio');
          expect(destructivePlan).toMatchObject({ from: additiveHash, to: destructiveHash });
          expect(destructivePlan['baselineDir']).toBeUndefined();
          const destructive = readBundle(dir, String(destructivePlan['dir']));
          expect(destructive).toMatchObject({ from: additiveHash, to: destructiveHash });
          expect(operationClasses(destructive)).toEqual([
            ['dropDefault.Post.likes', 'destructive'],
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
          await verifyOnlyLedgerUnclaimed();
          await v7('generate');
          const v7Destructive = await tsx('test/handover/v7-after-edit-2.ts');
          expect(v7Destructive).toContain(
            'Adopting Prisma 8 next to Prisma 7: 3 likes via Prisma 7',
          );
          expect(v7Destructive).toContain('comment: Commented through Prisma 7 via Prisma 7');
          expect(v7Destructive).toContain('likes cleared to null via Prisma 7');
          expect(v7Destructive).toContain(
            'bob@example.com columns: createdAt, email, id, name, role, updatedAt',
          );
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    timeouts.spinUpPpgDev * 6,
  );
});
