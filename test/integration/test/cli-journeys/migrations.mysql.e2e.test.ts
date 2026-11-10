/**
 * MySQL end to end through the CLI: `migration plan`, `db migrate`, `db verify` and `db sign` on the
 * example contract, then a nullable column added and dropped again. Skipped when `MYSQL_URL` is not set.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  getLatestMigrationDir,
  type JourneyContext,
  mysqlPslConfigFixture,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbSign,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  timeouts,
} from '../utils/journey-test-helpers';

const BASE = `// use prisma-8

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  role  Role
  posts Post[]
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  author   User   @relation(fields: [authorId], references: [id])
  authorId Int
}

enum Role {
  USER
  ADMIN
}
`;

const WITH_NICKNAME = BASE.replace('  role  Role\n', '  role  Role\n  nickname String?\n');

function setup(createTempDir: () => string, url: string): JourneyContext {
  const testDir = createTempDir();
  const configPath = join(testDir, 'prisma.config.ts');
  const config = readFileSync(mysqlPslConfigFixture, 'utf-8').replace('{{DB_URL}}', () => url);
  writeFileSync(configPath, config, 'utf-8');
  writeFileSync(join(testDir, 'contract.prisma'), BASE, 'utf-8');
  writeProjectManifest(testDir);
  return { testDir, configPath, outputDir: testDir };
}

async function emit(ctx: JourneyContext, psl: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `emit: ${emitted.stderr}`).toBe(0);
}

function latestMigrationTs(ctx: JourneyContext): string {
  return readFileSync(
    join(ctx.testDir, 'migrations', 'app', getLatestMigrationDir(ctx) ?? '', 'migration.ts'),
    'utf-8',
  );
}

async function migratedAndVerified(ctx: JourneyContext, step: string): Promise<void> {
  const migrated = await runMigrate(ctx);
  expect(migrated.exitCode, `${step} db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
  const verified = await runDbVerify(ctx);
  expect(verified.exitCode, `${step} db verify: ${verified.stdout}\n${verified.stderr}`).toBe(0);
}

withTempDir(({ createTempDir }) => {
  describe('MySQL: migrations, db verify and db sign', () => {
    it(
      'plans, migrates, verifies and signs the example contract, then adds and drops a column',
      async (test) => {
        await withMysqlDatabase(test, async ({ url }) => {
          const ctx = setup(createTempDir, url);
          await emit(ctx, BASE);

          const init = await planMigrationAndSelfEmit(ctx, ['--name', 'init']);
          expect(init.exitCode, `plan init: ${init.stderr}`).toBe(0);
          expect(latestMigrationTs(ctx)).toMatch(
            /this\.addForeignKey\(\{[^)]*'Post_authorId_fkey'/,
          );
          await migratedAndVerified(ctx, 'init');
          const signed = await runDbSign(ctx);
          expect(signed.exitCode, `db sign: ${signed.stdout}\n${signed.stderr}`).toBe(0);

          await emit(ctx, WITH_NICKNAME);
          const added = await planMigrationAndSelfEmit(ctx, ['--name', 'add-nickname']);
          expect(added.exitCode, `plan add: ${added.stdout}\n${added.stderr}`).toBe(0);
          expect(latestMigrationTs(ctx)).toMatch(
            /this\.addColumn\(\{[^)]*col\('nickname', 'varchar\(191\)'/,
          );
          await migratedAndVerified(ctx, 'add');

          await emit(ctx, BASE);
          const from = ['--from', getLatestMigrationDir(ctx) ?? ''];
          const asked = await runMigrationPlan(ctx, ['--name', 'drop-nickname', ...from, '--json']);
          expect(asked.exitCode, 'dropping a field is a question').not.toBe(0);
          const dropped = await planMigrationAndSelfEmit(ctx, [
            '--name',
            'drop-nickname',
            ...from,
            '--delete',
            'User.nickname',
          ]);
          expect(dropped.exitCode, `plan drop: ${dropped.stdout}\n${dropped.stderr}`).toBe(0);
          expect(latestMigrationTs(ctx)).toMatch(/this\.dropColumn\(\{[^)]*'nickname'/);
          await migratedAndVerified(ctx, 'drop');
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
