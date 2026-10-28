/**
 * A contract change that changes the storage hash but needs no database operation (SQLite).
 *
 * SQLite derives no check for an enum, but the enum's value set is part of the contract's storage. Adding a member changes the storage hash and needs no operation.
 *
 * Journey N1 plans the change: `migration plan` writes a migration with no operations, names the value set that changed, and `migrate` moves the marker to the new hash. Journey N2 applies the same change with `db update`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  readEmittedContractStorageHash,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  sqlitePslConfigFixture,
  timeouts,
} from '../utils/journey-test-helpers';

const FROM_PSL = `// use prisma-8

enum Role {
  @@type("sqlite/text@1")
  Admin  = "admin"
  Member = "member"
}

model User {
  id   Int  @id
  role Role
}
`;

const TO_PSL = FROM_PSL.replace(
  '  Member = "member"\n',
  '  Member = "member"\n  Guest  = "guest"\n',
);

interface NoOperationsPlan {
  readonly operations: readonly unknown[];
  readonly changedStorageEntities: readonly unknown[];
  readonly summary: string;
}

type SqliteJourney = JourneyContext & { readonly dbPath: string };

function setupSqliteJourney(createTempDir: () => string): SqliteJourney {
  const testDir = createTempDir();
  const dbPath = join(testDir, 'journey.db');
  const configPath = join(testDir, 'prisma.config.ts');
  const config = readFileSync(sqlitePslConfigFixture, 'utf-8').replace('{{DB_PATH}}', () => dbPath);
  writeFileSync(configPath, config, 'utf-8');
  writeProjectManifest(testDir);
  return { testDir, configPath, outputDir: testDir, dbPath };
}

async function emitContract(ctx: JourneyContext, psl: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}: emit: ${emit.stderr}`).toBe(0);
}

function markerHash(dbPath: string): unknown {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare(`SELECT core_hash FROM "_prisma_marker" WHERE space = 'app'`).get()?.[
      'core_hash'
    ];
  } finally {
    db.close();
  }
}

withTempDir(({ createTempDir }) => {
  describe('Journey N1 (SQLite): migration plan writes a migration with no operations', () => {
    it(
      'names the changed value set, and migrate moves the marker to the new hash',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emitContract(ctx, FROM_PSL, 'N1.01');
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `N1.02: plan initial: ${initial.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'N1.03: migrate initial').toBe(0);
        const origin = latestMigrationDirName(ctx);
        await emitContract(ctx, TO_PSL, 'N1.04');

        const plan = await runMigrationPlan(ctx, ['--from', origin, '--name', 'guest', '--json']);
        expect(plan.exitCode, `N1.05: plan: ${plan.stderr}`).toBe(0);
        const planned = parseJsonOutput<NoOperationsPlan>(plan);
        expect(
          {
            operations: planned.operations,
            changedStorageEntities: planned.changedStorageEntities,
            summary: planned.summary,
          },
          'N1.05: no operations',
        ).toEqual({
          operations: [],
          changedStorageEntities: [
            { plane: 'storage', entityKind: 'valueSet', entityName: 'Role' },
          ],
          summary: expect.stringContaining('What changed: value set "Role".'),
        });
        const dir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
        expect(JSON.parse(readFileSync(join(dir, 'ops.json'), 'utf-8')), 'N1.05: ops.json').toEqual(
          [],
        );

        const applied = await runMigrate(ctx);
        expect(applied.exitCode, `N1.06: migrate: ${applied.stderr}`).toBe(0);
        expect(markerHash(ctx.dbPath), 'N1.06: the marker').toBe(
          readEmittedContractStorageHash(ctx),
        );
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, `N1.07: db verify: ${verify.stderr}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey N2 (SQLite): db update applies a change with no operations', () => {
    it(
      'names the changed value set and moves the marker to the new hash',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emitContract(ctx, FROM_PSL, 'N2.01');
        const initial = await runDbUpdate(ctx);
        expect(initial.exitCode, `N2.02: db update initial: ${initial.stderr}`).toBe(0);
        await emitContract(ctx, TO_PSL, 'N2.03');

        const update = await runDbUpdate(ctx);
        expect(update.exitCode, `N2.04: db update: ${update.stderr}`).toBe(0);
        expect(`${update.stdout}${update.stderr}`, 'N2.04: names the changed value set').toContain(
          'The storage the contract describes changed, but the database needs no operation for it, so none ran and the database was signed with the new contract. What changed: value set "Role".',
        );
        expect(markerHash(ctx.dbPath), 'N2.04: the marker').toBe(
          readEmittedContractStorageHash(ctx),
        );
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, `N2.05: db verify: ${verify.stderr}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
