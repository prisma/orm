/**
 * The upgrade of a Prisma 7 project whose database was signed under the previous release, when the Prisma 7 reader stored every list with non-null elements and a waived element check. The test writes that stored contract and signs the database with its hash, then follows the app upgrade guide `skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md` step by step: run the script, `prisma db sign --db "$DATABASE_URL"`, `prisma contract emit`. `db verify` then passes with no migration.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { withClient } from '@repo/test-utils';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { appScript } from '../upgrade-instructions/remove-nocheck/test-helpers';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runDbSign,
  runDbVerify,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import { postgresStorageHash } from '../utils/journey-workspace-helpers';

const PRISMA7_FIXTURES = join(__dirname, '../fixtures/prisma7-source');
const JOURNEY_FIXTURES = join(__dirname, '../fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys');
const MIGRATION_SQL = readFileSync(join(PRISMA7_FIXTURES, 'supported/migration.sql'), 'utf-8');

type JsonRecord = Record<string, unknown>;

function records(value: unknown): readonly [string, JsonRecord][] {
  return typeof value === 'object' && value !== null
    ? (Object.entries(value) as [string, JsonRecord][])
    : [];
}

/** The contract as the previous release's Prisma 7 reader stored it: every list with non-null elements and a waived element check. */
function previousReleaseContract(json: JsonRecord): {
  readonly json: JsonRecord;
  readonly hash: string;
} {
  const contract = JSON.parse(JSON.stringify(json)) as JsonRecord;
  const storage = contract['storage'] as JsonRecord;
  for (const [, namespace] of records(storage['namespaces']))
    for (const [, table] of records((namespace['entries'] as JsonRecord)['table']))
      for (const [, column] of records(table['columns']))
        if (typeof column['many'] === 'object' && column['many'] !== null) {
          column['many'] = { elementNullable: false };
          column['noCheck'] = ['elementNotNull'];
        }
  for (const [, namespace] of records((contract['domain'] as JsonRecord)['namespaces']))
    for (const [, model] of records(namespace['models']))
      for (const [, field] of records(model['fields']))
        if (typeof field['many'] === 'object' && field['many'] !== null)
          field['many'] = { elementNullable: false };
  const { storageHash: _new, ...withoutHash } = storage;
  const hash = postgresStorageHash({
    target: String(contract['target']),
    targetFamily: String(contract['targetFamily']),
    storage: withoutHash,
  });
  storage['storageHash'] = hash;
  return { json: contract, hash };
}

function setupProject(createTempDir: () => string, connectionString: string): JourneyContext {
  const testDir = createTempDir();
  writeProjectManifest(testDir);
  mkdirSync(join(testDir, 'migrations'), { recursive: true });
  copyFileSync(join(PRISMA7_FIXTURES, 'supported/schema.prisma'), join(testDir, 'schema.prisma'));
  const config = readFileSync(join(JOURNEY_FIXTURES, 'prisma.config.prisma7.ts'), 'utf-8').replace(
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

function markerHash(connectionString: string): Promise<unknown> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(
      `SELECT core_hash FROM "prisma_contract"."marker" WHERE space = 'app'`,
    );
    return result.rows[0]?.['core_hash'];
  });
}

withTempDir(({ createTempDir }) => {
  describe('Journey: upgrading a signed Prisma 7 project past the removal of noCheck', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(MIGRATION_SQL)),
    });

    it(
      'the script, db sign and contract emit leave a database that verifies with no migration',
      async () => {
        const ctx = setupProject(createTempDir, db.connectionString);
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        const contractPath = join(ctx.testDir, 'contract.json');
        const current = JSON.parse(readFileSync(contractPath, 'utf-8')) as JsonRecord;
        const currentHash = (current['storage'] as JsonRecord)['storageHash'];
        const previous = previousReleaseContract(current);
        expect(previous.hash).not.toBe(currentHash);

        const sign = await runDbSign(ctx);
        expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);
        writeFileSync(contractPath, JSON.stringify(previous.json, null, 2));
        const dtsPath = join(ctx.testDir, 'contract.d.ts');
        writeFileSync(
          dtsPath,
          readFileSync(dtsPath, 'utf-8')
            .split(String(currentHash))
            .join(previous.hash)
            .replaceAll('readonly elementNullable: true', 'readonly elementNullable: false'),
        );
        await withClient(db.connectionString, (client) =>
          client.query(`UPDATE "prisma_contract"."marker" SET core_hash = $1 WHERE space = 'app'`, [
            previous.hash,
          ]),
        );
        const refused = await runDbVerify(ctx);
        expect(refused.exitCode, `db verify before the upgrade\n${output(refused)}`).not.toBe(0);

        const script = spawnSync(process.execPath, [appScript], {
          cwd: ctx.testDir,
          encoding: 'utf8',
        });
        expect({ status: script.status, stderr: script.stderr }).toEqual({ status: 0, stderr: '' });
        expect(script.stdout).toContain(`  ${previous.hash} -> ${currentHash}\n`);

        const signAfterScript = await runDbSign(ctx, ['--db', db.connectionString]);
        expect(signAfterScript.exitCode, `db sign\n${output(signAfterScript)}`).toBe(0);
        expect(await markerHash(db.connectionString)).toBe(currentHash);

        const reemit = await runContractEmit(ctx);
        expect(reemit.exitCode, `contract emit\n${output(reemit)}`).toBe(0);
        expect(JSON.parse(readFileSync(contractPath, 'utf-8')).storage.storageHash).toBe(
          currentHash,
        );

        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, `db verify\n${output(verify)}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
