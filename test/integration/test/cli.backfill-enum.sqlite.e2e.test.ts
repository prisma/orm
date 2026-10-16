/**
 * A new required enum field on SQLite gets no temporary value, since no one value stands for every
 * member. `migration plan --backfill` writes a data transform, the user fills its slot with a
 * member, `db migrate` applies it, and the ORM reads the member back.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import sqlite from '@internal/sqlite/runtime';
import { contractFromJson } from '@internal/sqlite/static';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from './utils/cli-test-helpers';
import {
  type JourneyContext,
  latestMigrationDirName,
  planMigrationAndSelfEmit,
  runContractEmit,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
  sqlitePslConfigFixture,
  timeouts,
} from './utils/journey-test-helpers';

const BASE = `// use prisma-8

model User {
  id   Int    @id
  name String
}
`;

const WITH_ROLE = `// use prisma-8

model User {
  id   Int    @id
  name String
  role Role
}

enum Role {
  @@type("sqlite/text@1")
  Admin  = "admin"
  Member = "member"
}
`;

type SqliteJourney = JourneyContext & { readonly dbPath: string };

function setup(createTempDir: () => string): SqliteJourney {
  const testDir = createTempDir();
  const dbPath = join(testDir, 'journey.db');
  const configPath = join(testDir, 'prisma.config.ts');
  const config = readFileSync(sqlitePslConfigFixture, 'utf-8').replace('{{DB_PATH}}', () => dbPath);
  writeFileSync(configPath, config, 'utf-8');
  writeFileSync(join(testDir, 'contract.prisma'), BASE, 'utf-8');
  writeProjectManifest(testDir);
  return { testDir, configPath, outputDir: testDir, dbPath };
}

async function readThroughOrm(ctx: SqliteJourney): Promise<unknown> {
  const contractJson: unknown = JSON.parse(
    readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8'),
  );
  const client = sqlite({
    contract: contractFromJson(contractJson),
    path: ctx.dbPath,
    verifyMarker: false,
  });
  try {
    await client.connect();
    const users = client.orm['User'];
    if (users === undefined) return expect.unreachable('the contract has a User model');
    const rows = await users.select('id', 'role').all();
    return [...rows].sort((left, right) => Number(left['id']) - Number(right['id']));
  } finally {
    await client.close();
  }
}

withTempDir(({ createTempDir }) => {
  describe('SQLite: a new required enum field on a table with rows', () => {
    it(
      'is filled through the backfill slot with a member the ORM reads back',
      async () => {
        const ctx = setup(createTempDir);
        expect((await runContractEmit(ctx)).exitCode, 'emit base').toBe(0);
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `plan initial: ${initial.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'apply initial').toBe(0);
        const db = new DatabaseSync(ctx.dbPath);
        try {
          db.exec(`INSERT INTO "User" (id, name) VALUES (1, 'al'), (2, 'bo')`);
        } finally {
          db.close();
        }

        writeFileSync(join(ctx.testDir, 'contract.prisma'), WITH_ROLE, 'utf-8');
        expect((await runContractEmit(ctx)).exitCode, 'emit with role').toBe(0);
        const planned = await runMigrationPlan(ctx, [
          '--name',
          'backfill-role',
          '--from',
          latestMigrationDirName(ctx),
          '--backfill',
          'User.role',
          '--json',
        ]);
        expect(planned.exitCode, `plan: ${planned.stderr}`).toBe(0);

        const migrationsDir = join(ctx.testDir, 'migrations', 'app');
        const [dirName] = readdirSync(migrationsDir).filter((dir) => dir.includes('backfill_role'));
        const migrationDir = join(migrationsDir, dirName ?? '');
        const migrationTs = join(migrationDir, 'migration.ts');
        const slot = /\(\) => placeholder\((['"])User\.role:run\1\)/;
        const scaffold = readFileSync(migrationTs, 'utf-8');
        expect(scaffold).toMatch(slot);
        writeFileSync(
          migrationTs,
          scaffold.replace(slot, '() => `UPDATE "User" SET role = \'member\' WHERE role IS NULL`'),
        );
        const emitted = await selfEmitMigration(ctx, [
          '--dir',
          migrationDir,
          '--config',
          ctx.configPath,
        ]);
        expect(emitted.exitCode, `self-emit: ${emitted.stderr}`).toBe(0);
        const applied = await runMigrate(ctx);
        expect(applied.exitCode, `apply: ${applied.stdout}\n${applied.stderr}`).toBe(0);

        expect(await readThroughOrm(ctx)).toEqual([
          { id: 1, role: 'member' },
          { id: 2, role: 'member' },
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
