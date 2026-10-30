import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import pgvector from '@internal/extension-pgvector/control';
import { readRef } from '@internal/migration-tools/refs';
import { withClient, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { TEST_BASELINE_INVARIANT_ID, TEST_SPACE_ID } from './contract-space-fixture/constants';
import testContractSpaceExtension from './contract-space-fixture/control';
import testSqliteSpaceExtension from './contract-space-fixture/sqlite';
import { runOnEngine, setupTestDirectoryFromFixtures, withTempDir } from './utils/cli-test-helpers';
import {
  ageMarkersOnPostgres,
  ageMarkersOnSqlite,
  createPgvectorSchema,
  createPostgresTables,
  expectProjectWorksAgainstDatabase,
  JOURNEY_TIMEOUT,
  MOVED_APP_HASH,
  OLD_APP_HASH,
  OLD_EXT_HASH,
  type Project,
  postgresMarkers,
  prepareProject,
  signedSpaces,
  signRefusingTestSpace,
  sqliteMarkers,
} from './utils/db-sign-spaces-helpers';

/**
 * A database signed before an upgrade holds marker hashes the rewritten project no longer knows. One `db sign` run re-signs the app space and the extension space, after which `db verify`, `migrate` and `migration status` succeed. A space whose schema does not verify keeps its old marker and is reported with its drift.
 */

const PGVECTOR_SPACE_ID = 'pgvector';
const PGVECTOR_INVARIANT_ID = 'pgvector:install-vector-v1';

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
            extensionMarker: 'exists',
          });

          const sign = await runOnEngine(project, ['db', 'sign', '--json']);

          expect(sign.exitCode, `db sign: ${sign.stderr}`).toBe(0);
          expect(signedSpaces(sign)).toEqual([
            { space: 'app', status: 'updated', storageHash: appHash, previous: OLD_APP_HASH },
            {
              space: PGVECTOR_SPACE_ID,
              status: 'updated',
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
          await signRefusingTestSpace(project, { appHash, extHash }, () =>
            postgresMarkers(connectionString),
          );
          await ageMarkersOnPostgres(connectionString, {
            id: TEST_SPACE_ID,
            invariant: TEST_BASELINE_INVARIANT_ID,
            extensionMarker: 'absent',
          });
          await withClient(connectionString, (client) => client.query('DROP TABLE test_box'));

          const sign = await runOnEngine(project, ['db', 'sign', '--json']);

          expect(sign.exitCode, `db sign: ${sign.stderr}`).toBe(4);
          expect(signedSpaces(sign)).toEqual([
            { space: 'app', status: 'updated', storageHash: appHash, previous: OLD_APP_HASH },
            { space: TEST_SPACE_ID, status: 'failed', storageHash: extHash, previous: undefined },
          ]);
          expect(sign.presented?.diagnostics).toEqual([
            expect.objectContaining({
              code: 'CONTRACT.SCHEMA_VERIFICATION_FAILED',
              severity: 'error',
              meta: expect.objectContaining({
                space: TEST_SPACE_ID,
                schemaIssues: expect.arrayContaining([
                  expect.objectContaining({ path: expect.arrayContaining(['test_box']) }),
                ]),
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
          await signRefusingTestSpace(project, { appHash, extHash }, () => sqliteMarkers(db));
          ageMarkersOnSqlite(db);

          const sign = await runOnEngine(project, ['db', 'sign', '--json']);

          expect(sign.exitCode, `db sign: ${sign.stderr}`).toBe(0);
          expect(signedSpaces(sign)).toEqual([
            { space: 'app', status: 'updated', storageHash: appHash, previous: OLD_APP_HASH },
            {
              space: TEST_SPACE_ID,
              status: 'updated',
              storageHash: extHash,
              previous: OLD_EXT_HASH,
            },
          ]);
          expect(sqliteMarkers(db)).toEqual({
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
          await signRefusingTestSpace(project, { appHash, extHash }, () =>
            postgresMarkers(connectionString),
          );
          await ageMarkersOnPostgres(connectionString, {
            id: TEST_SPACE_ID,
            invariant: TEST_BASELINE_INVARIANT_ID,
            extensionMarker: 'absent',
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
              status: 'updated',
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
          await signRefusingTestSpace(project, { appHash, extHash }, () => sqliteMarkers(db));
          ageMarkersOnSqlite(db);
          writeRace(project, `UPDATE _prisma_marker SET core_hash = ? WHERE space = 'app'`);

          const sign = await runOnEngine(project, ['db', 'sign', '--json']);

          expect(sign.exitCode, `db sign: ${sign.stderr}`).toBe(4);
          expect(signedSpaces(sign)).toEqual([
            { space: 'app', status: 'conflict', storageHash: appHash, previous: undefined },
            {
              space: TEST_SPACE_ID,
              status: 'updated',
              storageHash: extHash,
              previous: OLD_EXT_HASH,
            },
          ]);
          expectAppMarkerChanged(sign, appHash);
          expect(sqliteMarkers(db)).toEqual({
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
