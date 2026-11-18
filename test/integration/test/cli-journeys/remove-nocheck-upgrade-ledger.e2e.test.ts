/**
 * The upgrade of a project with migrations, applied by the previous release, past the removal of `noCheck`. The project is the remove-nocheck fixture's "before" tree. The database holds what the previous release left after `db migrate`: the tables, a marker with the old storage hash, and one ledger row and one stored contract per migration, under the old migration and storage hashes. The ledger rows have the shape a run of the previous release's CLI wrote. The test then follows the app upgrade fragment: the script, `prisma db sign --db "$DATABASE_URL"`, the source rewrite to `T?[]`, and `prisma contract emit`.
 *
 * It records what the upgrade leaves: `db migrate` applies nothing and `db verify` passes, but `migration status` no longer marks the two migrations applied before the upgrade as applied, because the script gave them new migration hashes and the ledger keeps the old ones.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { withClient } from '@repo/test-utils';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import {
  appScript,
  fixtureTree,
  writeTree,
} from '../upgrade-instructions/remove-nocheck/test-helpers';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  runContractEmit,
  runDbSign,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationStatus,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const BEFORE_SOURCE = `// use prisma-8

model Post {
  id     Int      @id
  tags   String[] @noCheck(elementNotNull)
  labels String[] @noCheck(elementNotNull)
  scores Int[]

  @@map("post")
}
`;

const REWRITTEN_SOURCE = BEFORE_SOURCE.replaceAll('String[] @noCheck(elementNotNull)', 'String?[]');

interface StoredMigration {
  readonly name: string;
  readonly from: string | null;
  readonly to: string;
  readonly migrationHash: string;
}

function output(run: { readonly stdout: string; readonly stderr: string }): string {
  return `${stripAnsi(run.stderr)}\n${stripAnsi(run.stdout)}`;
}

function migrationsOf(tree: Record<string, string>): readonly StoredMigration[] {
  return Object.entries(tree)
    .filter(([path]) => path.endsWith('/migration.json'))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, text]) => {
      const metadata = JSON.parse(text);
      return {
        name: path.split('/').at(-2) ?? '',
        from: metadata.from,
        to: metadata.to,
        migrationHash: metadata.migrationHash,
      };
    });
}

withTempDir(({ createTempDir }) => {
  describe('Journey: upgrading a migrated project past the removal of noCheck', () => {
    const db = useDevDatabase();

    it(
      'leaves nothing to apply and a database that verifies, but migration status loses the applied marks',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeFileSync(join(ctx.testDir, 'contract.prisma'), REWRITTEN_SOURCE);
        const emitted = await runContractEmit(ctx);
        expect(emitted.exitCode, `contract emit\n${output(emitted)}`).toBe(0);
        const built = await runDbUpdate(ctx);
        expect(built.exitCode, `db update\n${output(built)}`).toBe(0);

        const before = fixtureTree('before');
        const migrations = migrationsOf(before);
        const head = migrations.at(-1);
        if (head === undefined) throw new Error('the fixture has no migration');
        rmSync(join(ctx.testDir, 'migrations'), { recursive: true, force: true });
        writeTree(ctx.testDir, {
          ...Object.fromEntries(
            Object.entries(before).filter(([path]) => path.startsWith('migrations/')),
          ),
          'contract.json': before['prisma/contract.json'] ?? '',
          'contract.d.ts': before['prisma/contract.d.ts'] ?? '',
          'contract.prisma': BEFORE_SOURCE,
        });
        await withClient(db.connectionString, async (client) => {
          await client.query(`DELETE FROM "prisma_contract"."ledger"`);
          await client.query(`DELETE FROM "prisma_contract"."contract"`);
          for (const migration of migrations) {
            await client.query(
              `INSERT INTO "prisma_contract"."ledger" (space, migration_name, migration_hash, origin_core_hash, destination_core_hash, operations) VALUES ('app', $1, $2, $3, $4, '[]'::jsonb)`,
              [migration.name, migration.migrationHash, migration.from ?? 'empty', migration.to],
            );
            await client.query(
              `INSERT INTO "prisma_contract"."contract" (core_hash, contract_json) VALUES ($1, $2::jsonb)`,
              [migration.to, before[`migrations/snapshots/${migration.to}/contract.json`]],
            );
          }
          await client.query(
            `UPDATE "prisma_contract"."marker" SET core_hash = $1 WHERE space = 'app'`,
            [head.to],
          );
        });

        const script = spawnSync(process.execPath, [appScript], {
          cwd: ctx.testDir,
          encoding: 'utf8',
        });
        expect({ status: script.status, stderr: script.stderr }).toEqual({ status: 0, stderr: '' });

        const sign = await runDbSign(ctx, ['--db', db.connectionString]);
        expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);

        const rewritten = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8').replaceAll(
          'String[] @noCheck(elementNotNull)',
          'String?[]',
        );
        writeFileSync(join(ctx.testDir, 'contract.prisma'), rewritten);
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);

        const migrate = await runMigrate(ctx, ['--json']);
        expect(migrate.exitCode, `db migrate\n${output(migrate)}`).toBe(0);
        expect(migrate.presented?.data).toMatchObject({ summary: 'Already up to date' });

        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, `db verify\n${output(verify)}`).toBe(0);

        const status = await runMigrationStatus(ctx, ['--json']);
        expect(status.exitCode, `migration status\n${output(status)}`).toBe(0);
        const report = status.presented?.data as {
          readonly summary: string;
          readonly spaces: readonly {
            readonly migrations: readonly { readonly name: string; readonly status: unknown }[];
          }[];
        };
        expect({
          summary: report.summary,
          migrations: report.spaces[0]?.migrations
            .map(({ name, status }) => ({ name, status }))
            .sort((x, y) => (x.name < y.name ? -1 : 1)),
        }).toEqual({
          summary: 'Up to date',
          migrations: migrations.map(({ name }) => ({ name, status: null })),
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
