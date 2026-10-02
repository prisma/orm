import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import pgvector from '@internal/extension-pgvector/control';
import type { SqlControlExtensionDescriptor } from '@internal/family-sql/control';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { materialiseMigrationPackage } from '@internal/migration-tools/io';
import { readRef } from '@internal/migration-tools/refs';
import { emitContractSpaceArtifacts } from '@internal/migration-tools/spaces';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { TEST_BASELINE_INVARIANT_ID, TEST_SPACE_ID } from './contract-space-fixture/constants';
import testContractSpaceExtension from './contract-space-fixture/control';
import testSqliteSpaceExtension from './contract-space-fixture/sqlite';
import { runOnEngine, setupTestDirectoryFromFixtures, withTempDir } from './utils/cli-test-helpers';
import { engineDiagnosticCodes, planMigrationAndSelfEmit } from './utils/journey-test-helpers';

/**
 * A database signed before an upgrade holds marker hashes the rewritten project no longer knows. One `db sign` run re-signs the app space and the extension space, after which `db verify`, `migrate` and `migration status` succeed. A space whose schema does not verify keeps its old marker and is reported with its drift.
 */

const OLD_APP_HASH = `0ld0a99${'1'.repeat(57)}`;
const OLD_EXT_HASH = `0ld0e77${'2'.repeat(57)}`;
const MOVED_APP_HASH = `m0ved0a${'3'.repeat(57)}`;
const JOURNEY_TIMEOUT = timeouts.spinUpPpgDev + timeouts.typeScriptCompilation;
const PGVECTOR_SPACE_ID = 'pgvector';
const PGVECTOR_INVARIANT_ID = 'pgvector:install-vector-v1';

interface Project {
  readonly testDir: string;
  readonly configPath: string;
  readonly outputDir: string;
}

interface SignedSpaceJson {
  readonly space: string;
  readonly status: string;
  readonly contract: { readonly storageHash: string };
  readonly marker?: { readonly previous?: { readonly storageHash: string } };
}

async function writePinnedExtensionDir(
  testDir: string,
  extension: SqlControlExtensionDescriptor<'postgres'> | SqlControlExtensionDescriptor<'sqlite'>,
): Promise<string> {
  const space = extension.contractSpace;
  if (space === undefined) {
    throw new Error(`extension "${extension.id}" declares no contract space`);
  }
  const migrationsDir = join(testDir, 'migrations');
  await mkdir(migrationsDir, { recursive: true });
  await emitContractSpaceArtifacts(migrationsDir, extension.id, {
    contract: space.contractJson,
    contractDts: '// placeholder for test\nexport {};\n',
    headRef: { hash: space.headRef.hash, invariants: [...space.headRef.invariants] },
  });
  for (const pkg of space.migrations) {
    const ops = [...pkg.ops];
    await materialiseMigrationPackage(join(migrationsDir, extension.id), {
      dirName: pkg.dirName,
      metadata: { ...pkg.metadata, migrationHash: computeMigrationHash(pkg.metadata, ops) },
      ops,
    });
  }
  return space.headRef.hash;
}

function emittedStorageHash(project: Project): string {
  const contract = JSON.parse(readFileSync(join(project.outputDir, 'contract.json'), 'utf-8'));
  return contract.storage.storageHash;
}

function signedSpaces(run: { readonly presented: { readonly data: unknown } | undefined }) {
  const data = run.presented?.data as { readonly spaces: readonly SignedSpaceJson[] } | undefined;
  return (data?.spaces ?? []).map((space) => ({
    space: space.space,
    status: space.status,
    storageHash: space.contract.storageHash,
    previous: space.marker?.previous?.storageHash,
  }));
}

async function prepareProject(
  project: Project,
  extension: Parameters<typeof writePinnedExtensionDir>[1],
) {
  const extHash = await writePinnedExtensionDir(project.testDir, extension);
  const emit = await runOnEngine(project, ['contract', 'emit']);
  expect(emit.exitCode, `emit: ${emit.stderr}`).toBe(0);
  const plan = await planMigrationAndSelfEmit(project, ['--name', 'init']);
  expect(plan.exitCode, `plan: ${plan.stderr}`).toBe(0);
  return { appHash: emittedStorageHash(project), extHash };
}

/** The steps a user runs after re-signing: every one must succeed. */
async function expectProjectWorksAgainstDatabase(project: Project): Promise<void> {
  const verify = await runOnEngine(project, ['db', 'verify', '--json']);
  expect(verify.exitCode, `db verify: ${verify.stderr}`).toBe(0);

  const migrate = await runOnEngine(project, ['db', 'migrate']);
  expect(migrate.exitCode, `migrate: ${migrate.stderr}`).toBe(0);
  expect(migrate.stderr).toContain('Already up to date');

  const status = await runOnEngine(project, ['migration', 'status', '--json']);
  expect(status.exitCode, `migration status: ${status.stderr}`).toBe(0);
  expect(engineDiagnosticCodes(status)).not.toContain('MIGRATION.MARKER_NOT_IN_HISTORY');
}

async function postgresMarkers(connectionString: string): Promise<Record<string, unknown>> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(
      'SELECT space, core_hash FROM prisma_contract.marker ORDER BY space',
    );
    return Object.fromEntries(result.rows.map((row) => [row.space, row.core_hash]));
  });
}

/** Makes the database look signed before the upgrade: markers hold hashes the project no longer has. */
async function ageMarkersOnPostgres(
  connectionString: string,
  extensionSpace: { readonly id: string; readonly invariant: string },
): Promise<void> {
  await withClient(connectionString, async (client) => {
    await client.query(`UPDATE prisma_contract.marker SET core_hash = $1 WHERE space = 'app'`, [
      OLD_APP_HASH,
    ]);
    await client.query(
      'UPDATE prisma_contract.marker SET core_hash = $1, invariants = $2::text[] WHERE space = $3',
      [OLD_EXT_HASH, [extensionSpace.invariant], extensionSpace.id],
    );
  });
}

async function createPgvectorSchema(connectionString: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    await client.query(
      'CREATE TABLE "user" (id integer NOT NULL, email text NOT NULL, PRIMARY KEY (id))',
    );
    await client.query('CREATE EXTENSION vector');
  });
}

async function createPostgresTables(connectionString: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    await client.query(
      'CREATE TABLE "user" (id integer NOT NULL, email text NOT NULL, PRIMARY KEY (id))',
    );
    await client.query('CREATE TABLE test_box (x integer NOT NULL, y integer NOT NULL)');
  });
}

withTempDir(({ createTempDir }) => {
  describe('db sign over every contract space', () => {
    it(
      're-signs the app and the pgvector space on PGlite, after which the project works',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = setupTestDirectoryFromFixtures(
            createTempDir,
            'db-sign-spaces',
            'prisma.config.pgvector.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const { appHash, extHash } = await prepareProject(project, pgvector);
          await createPgvectorSchema(connectionString);
          const first = await runOnEngine(project, ['db', 'sign', '--json']);
          expect(first.exitCode, `first sign: ${first.stderr}`).toBe(0);
          await ageMarkersOnPostgres(connectionString, {
            id: PGVECTOR_SPACE_ID,
            invariant: PGVECTOR_INVARIANT_ID,
          });

          const sign = await runOnEngine(project, ['db', 'sign', '--json']);

          expect(sign.exitCode, `db sign: ${sign.stderr}`).toBe(0);
          expect(signedSpaces(sign)).toEqual([
            { space: 'app', status: 'signed', storageHash: appHash, previous: OLD_APP_HASH },
            {
              space: PGVECTOR_SPACE_ID,
              status: 'signed',
              storageHash: extHash,
              previous: OLD_EXT_HASH,
            },
          ]);
          expect(await postgresMarkers(connectionString)).toEqual({
            app: appHash,
            [PGVECTOR_SPACE_ID]: extHash,
          });
          const refsDir = (space: string) => join(project.testDir, 'migrations', space, 'refs');
          expect((await readRef(refsDir('app'), 'db')).hash).toBe(appHash);
          expect((await readRef(refsDir(PGVECTOR_SPACE_ID), 'db')).hash).toBe(extHash);
          await expectProjectWorksAgainstDatabase(project);
        });
      },
      JOURNEY_TIMEOUT,
    );

    it(
      'keeps the marker of a space that fails verification, signs the other and exits 4',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = setupTestDirectoryFromFixtures(
            createTempDir,
            'db-sign-spaces',
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const { appHash, extHash } = await prepareProject(project, testContractSpaceExtension);
          await createPostgresTables(connectionString);
          const first = await runOnEngine(project, ['db', 'sign', '--json']);
          expect(first.exitCode, `first sign: ${first.stderr}`).toBe(0);
          await ageMarkersOnPostgres(connectionString, {
            id: TEST_SPACE_ID,
            invariant: TEST_BASELINE_INVARIANT_ID,
          });
          await withClient(connectionString, (client) => client.query('DROP TABLE test_box'));

          const sign = await runOnEngine(project, ['db', 'sign', '--json']);

          expect(sign.exitCode, `db sign: ${sign.stderr}`).toBe(4);
          expect(signedSpaces(sign)).toEqual([
            { space: 'app', status: 'signed', storageHash: appHash, previous: OLD_APP_HASH },
            { space: TEST_SPACE_ID, status: 'failed', storageHash: extHash, previous: undefined },
          ]);
          expect(sign.presented?.diagnostics).toEqual([
            expect.objectContaining({
              code: 'CONTRACT.SCHEMA_VERIFICATION_FAILED',
              severity: 'error',
              meta: expect.objectContaining({
                space: TEST_SPACE_ID,
                issues: expect.arrayContaining([expect.stringContaining('test_box')]),
              }),
            }),
          ]);
          expect(await postgresMarkers(connectionString)).toEqual({
            app: appHash,
            [TEST_SPACE_ID]: OLD_EXT_HASH,
          });
        });
      },
      JOURNEY_TIMEOUT,
    );

    it(
      're-signs the app and an extension space on SQLite, after which the project works',
      async () => {
        const project = setupTestDirectoryFromFixtures(
          createTempDir,
          'db-sign-spaces-sqlite',
          'prisma.config.with-db.ts',
        );
        const dbPath = join(project.testDir, 'app.db');
        writeFileSync(
          project.configPath,
          readFileSync(project.configPath, 'utf-8').replace('{{DB_PATH}}', dbPath),
        );
        copyFileSync(
          join(
            __dirname,
            'fixtures/cli/cli-e2e-test-app/fixtures/db-sign-spaces-sqlite/contract.prisma',
          ),
          join(project.testDir, 'contract.prisma'),
        );
        const { appHash, extHash } = await prepareProject(project, testSqliteSpaceExtension);
        const db = new DatabaseSync(dbPath);
        try {
          db.exec('CREATE TABLE "user" (id integer NOT NULL PRIMARY KEY, email text NOT NULL)');
          db.exec('CREATE TABLE test_box (x integer NOT NULL, y integer NOT NULL)');
          const first = await runOnEngine(project, ['db', 'sign', '--json']);
          expect(first.exitCode, `first sign: ${first.stderr}`).toBe(0);
          db.prepare(`UPDATE _prisma_marker SET core_hash = ? WHERE space = 'app'`).run(
            OLD_APP_HASH,
          );
          db.prepare('UPDATE _prisma_marker SET core_hash = ?, invariants = ? WHERE space = ?').run(
            OLD_EXT_HASH,
            JSON.stringify([TEST_BASELINE_INVARIANT_ID]),
            TEST_SPACE_ID,
          );

          const sign = await runOnEngine(project, ['db', 'sign', '--json']);

          expect(sign.exitCode, `db sign: ${sign.stderr}`).toBe(0);
          expect(signedSpaces(sign)).toEqual([
            { space: 'app', status: 'signed', storageHash: appHash, previous: OLD_APP_HASH },
            {
              space: TEST_SPACE_ID,
              status: 'signed',
              storageHash: extHash,
              previous: OLD_EXT_HASH,
            },
          ]);
          const markers = db
            .prepare('SELECT space, core_hash FROM _prisma_marker ORDER BY space')
            .all();
          expect(
            Object.fromEntries(markers.map((row) => [row['space'], row['core_hash']])),
          ).toEqual({
            app: appHash,
            [TEST_SPACE_ID]: extHash,
          });
          await expectProjectWorksAgainstDatabase(project);
        } finally {
          db.close();
        }
      },
      JOURNEY_TIMEOUT,
    );
  });

  describe('db sign when another process changes a marker while it runs', () => {
    function writeRace(project: Project, sql: string): void {
      writeFileSync(
        join(project.testDir, 'race.json'),
        JSON.stringify({ sql, params: [MOVED_APP_HASH] }),
      );
    }

    function expectAppMarkerChanged(
      sign: Awaited<ReturnType<typeof runOnEngine>>,
      appHash: string,
    ) {
      expect(sign.presented?.diagnostics).toEqual([
        expect.objectContaining({
          code: 'MIGRATION.MARKER_CAS_FAILURE',
          severity: 'error',
          summary: 'Marker of space "app" changed while db sign ran',
          meta: {
            space: 'app',
            expectedStorageHash: OLD_APP_HASH,
            foundStorageHash: MOVED_APP_HASH,
            destinationStorageHash: appHash,
          },
        }),
      ]);
    }

    it(
      'leaves the marker it did not verify on PGlite, signs the other space and exits 4',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = setupTestDirectoryFromFixtures(
            createTempDir,
            'db-sign-spaces',
            'prisma.config.racing.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const { appHash, extHash } = await prepareProject(project, testContractSpaceExtension);
          await createPostgresTables(connectionString);
          const first = await runOnEngine(project, ['db', 'sign', '--json']);
          expect(first.exitCode, `first sign: ${first.stderr}`).toBe(0);
          await ageMarkersOnPostgres(connectionString, {
            id: TEST_SPACE_ID,
            invariant: TEST_BASELINE_INVARIANT_ID,
          });
          writeRace(
            project,
            `UPDATE prisma_contract.marker SET core_hash = $1 WHERE space = 'app'`,
          );

          const sign = await runOnEngine(project, ['db', 'sign', '--json']);

          expect(sign.exitCode, `db sign: ${sign.stderr}`).toBe(4);
          expect(signedSpaces(sign)).toEqual([
            { space: 'app', status: 'conflict', storageHash: appHash, previous: undefined },
            {
              space: TEST_SPACE_ID,
              status: 'signed',
              storageHash: extHash,
              previous: OLD_EXT_HASH,
            },
          ]);
          expectAppMarkerChanged(sign, appHash);
          expect(await postgresMarkers(connectionString)).toEqual({
            app: MOVED_APP_HASH,
            [TEST_SPACE_ID]: extHash,
          });
        });
      },
      JOURNEY_TIMEOUT,
    );

    it(
      'leaves the marker it did not verify on SQLite, signs the other space and exits 4',
      async () => {
        const project = setupTestDirectoryFromFixtures(
          createTempDir,
          'db-sign-spaces-sqlite',
          'prisma.config.racing.with-db.ts',
        );
        const dbPath = join(project.testDir, 'app.db');
        writeFileSync(
          project.configPath,
          readFileSync(project.configPath, 'utf-8').replace('{{DB_PATH}}', dbPath),
        );
        copyFileSync(
          join(
            __dirname,
            'fixtures/cli/cli-e2e-test-app/fixtures/db-sign-spaces-sqlite/contract.prisma',
          ),
          join(project.testDir, 'contract.prisma'),
        );
        const { appHash, extHash } = await prepareProject(project, testSqliteSpaceExtension);
        const db = new DatabaseSync(dbPath);
        try {
          db.exec('CREATE TABLE "user" (id integer NOT NULL PRIMARY KEY, email text NOT NULL)');
          db.exec('CREATE TABLE test_box (x integer NOT NULL, y integer NOT NULL)');
          const first = await runOnEngine(project, ['db', 'sign', '--json']);
          expect(first.exitCode, `first sign: ${first.stderr}`).toBe(0);
          db.prepare(`UPDATE _prisma_marker SET core_hash = ? WHERE space = 'app'`).run(
            OLD_APP_HASH,
          );
          db.prepare('UPDATE _prisma_marker SET core_hash = ?, invariants = ? WHERE space = ?').run(
            OLD_EXT_HASH,
            JSON.stringify([TEST_BASELINE_INVARIANT_ID]),
            TEST_SPACE_ID,
          );
          writeRace(project, `UPDATE _prisma_marker SET core_hash = ? WHERE space = 'app'`);

          const sign = await runOnEngine(project, ['db', 'sign', '--json']);

          expect(sign.exitCode, `db sign: ${sign.stderr}`).toBe(4);
          expect(signedSpaces(sign)).toEqual([
            { space: 'app', status: 'conflict', storageHash: appHash, previous: undefined },
            {
              space: TEST_SPACE_ID,
              status: 'signed',
              storageHash: extHash,
              previous: OLD_EXT_HASH,
            },
          ]);
          expectAppMarkerChanged(sign, appHash);
          const markers = db
            .prepare('SELECT space, core_hash FROM _prisma_marker ORDER BY space')
            .all();
          expect(
            Object.fromEntries(markers.map((row) => [row['space'], row['core_hash']])),
          ).toEqual({
            app: MOVED_APP_HASH,
            [TEST_SPACE_ID]: extHash,
          });
        } finally {
          db.close();
        }
      },
      JOURNEY_TIMEOUT,
    );
  });
});
