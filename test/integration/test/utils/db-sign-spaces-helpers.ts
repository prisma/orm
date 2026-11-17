import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import type { SqlControlExtensionDescriptor } from '@internal/family-sql/control';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { materialiseMigrationPackage } from '@internal/migration-tools/io';
import { readRef } from '@internal/migration-tools/refs';
import { emitContractSpaceArtifacts } from '@internal/migration-tools/spaces';
import { timeouts, withClient } from '@repo/test-utils';
import { join } from 'pathe';
import { expect } from 'vitest';
import { TEST_BASELINE_INVARIANT_ID, TEST_SPACE_ID } from '../contract-space-fixture/constants';
import { runOnEngine } from './cli-test-helpers';
import { engineDiagnosticCodes, planMigrationAndSelfEmit } from './journey-test-helpers';

export const OLD_APP_HASH = `0ld0a99${'1'.repeat(57)}`;
export const OLD_EXT_HASH = `0ld0e77${'2'.repeat(57)}`;
export const MOVED_APP_HASH = `m0ved0a${'3'.repeat(57)}`;
export const JOURNEY_TIMEOUT = timeouts.spinUpPpgDev + timeouts.typeScriptCompilation;

export interface Project {
  readonly testDir: string;
  readonly configPath: string;
  readonly outputDir: string;
}

interface SignedSpaceJson {
  readonly space: string;
  readonly status: string;
  readonly contract: { readonly storageHash: string };
  readonly previous?: { readonly storageHash: string };
}

type Markers = Record<string, unknown>;

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

export function signedSpaces(run: { readonly presented: { readonly data: unknown } | undefined }) {
  const data = run.presented?.data as { readonly spaces: readonly SignedSpaceJson[] } | undefined;
  return (data?.spaces ?? []).map((space) => ({
    space: space.space,
    status: space.status,
    storageHash: space.contract.storageHash,
    previous: space.previous?.storageHash,
  }));
}

export async function prepareProject(
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
export async function expectProjectWorksAgainstDatabase(project: Project): Promise<void> {
  const verify = await runOnEngine(project, ['db', 'verify', '--json']);
  expect(verify.exitCode, `db verify: ${verify.stderr}`).toBe(0);

  const migrate = await runOnEngine(project, ['db', 'migrate']);
  expect(migrate.exitCode, `migrate: ${migrate.stderr}`).toBe(0);
  expect(migrate.stderr).toContain('Already up to date');

  const status = await runOnEngine(project, ['migration', 'status', '--json']);
  expect(status.exitCode, `migration status: ${status.stderr}`).toBe(0);
  expect(engineDiagnosticCodes(status)).not.toContain('MIGRATION.MARKER_NOT_IN_HISTORY');
}

export async function postgresMarkers(connectionString: string): Promise<Markers> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(
      'SELECT space, core_hash FROM prisma_contract.marker ORDER BY space',
    );
    return Object.fromEntries(result.rows.map((row) => [row.space, row.core_hash]));
  });
}

export async function postgresMarkerTableExists(connectionString: string): Promise<boolean> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(
      `SELECT to_regclass('prisma_contract.marker') IS NOT NULL AS exists`,
    );
    return result.rows[0]?.exists === true;
  });
}

export function sqliteMarkers(db: DatabaseSync): Markers {
  const rows = db.prepare('SELECT space, core_hash FROM _prisma_marker ORDER BY space').all();
  return Object.fromEntries(rows.map((row) => [row['space'], row['core_hash']]));
}

function snapshotStore(project: Project): readonly string[] {
  return readdirSync(join(project.testDir, 'migrations', 'snapshots')).sort();
}

export function dbRefPath(project: Project, space: string): string {
  return join(project.testDir, 'migrations', space, 'refs', 'db.json');
}

/**
 * The first `db sign` of a fresh database signs the app space and refuses the test extension's space: its head ref requires an invariant that only running its migration records. The refused space gets no marker row and no `db` ref, and the snapshot store is left as it was.
 */
export async function signRefusingTestSpace(
  project: Project,
  hashes: { readonly appHash: string; readonly extHash: string },
  readMarkers: () => Promise<Markers> | Markers,
): Promise<void> {
  const snapshotsBefore = snapshotStore(project);

  const first = await runOnEngine(project, ['db', 'sign', '--json']);

  expect(first.exitCode, `first sign: ${first.stderr}`).toBe(4);
  expect(signedSpaces(first)).toEqual([
    { space: 'app', status: 'created', storageHash: hashes.appHash, previous: undefined },
    {
      space: TEST_SPACE_ID,
      status: 'missing-invariants',
      storageHash: hashes.extHash,
      previous: undefined,
    },
  ]);
  expect(await readMarkers()).toEqual({ app: hashes.appHash });
  expect((await readRef(join(project.testDir, 'migrations', 'app', 'refs'), 'db')).hash).toBe(
    hashes.appHash,
  );
  expect(existsSync(dbRefPath(project, TEST_SPACE_ID))).toBe(false);
  expect(snapshotStore(project)).toEqual(snapshotsBefore);
}

/**
 * Makes a database signed before an upgrade look as it did then: the app marker holds a hash the project no longer has, and the extension space's marker holds an old hash and records the invariant its migration provided, as it would after that migration ran. `extensionMarker` says whether the extension space already has a marker row to age or needs one inserted; each statement must touch exactly one row.
 */
export async function ageMarkersOnPostgres(
  connectionString: string,
  extensionSpace: {
    readonly id: string;
    readonly invariant: string;
    readonly extensionMarker: 'exists' | 'absent';
  },
): Promise<void> {
  await withClient(connectionString, async (client) => {
    const app = await client.query(
      `UPDATE prisma_contract.marker SET core_hash = $1 WHERE space = 'app'`,
      [OLD_APP_HASH],
    );
    const extension =
      extensionSpace.extensionMarker === 'exists'
        ? await client.query(
            'UPDATE prisma_contract.marker SET core_hash = $1, invariants = $2::text[] WHERE space = $3',
            [OLD_EXT_HASH, [extensionSpace.invariant], extensionSpace.id],
          )
        : await client.query(
            `INSERT INTO prisma_contract.marker (space, core_hash, profile_hash, invariants)
             VALUES ($3, $1, $1, $2::text[])`,
            [OLD_EXT_HASH, [extensionSpace.invariant], extensionSpace.id],
          );
    expect([app.rowCount, extension.rowCount]).toEqual([1, 1]);
  });
}

/** {@link ageMarkersOnPostgres} on SQLite, after a sign that refused the test extension's space. */
export function ageMarkersOnSqlite(db: DatabaseSync): void {
  const app = db
    .prepare(`UPDATE _prisma_marker SET core_hash = ? WHERE space = 'app'`)
    .run(OLD_APP_HASH);
  const extension = db
    .prepare(
      `INSERT INTO _prisma_marker (space, core_hash, profile_hash, updated_at, invariants)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      TEST_SPACE_ID,
      OLD_EXT_HASH,
      OLD_EXT_HASH,
      new Date(0).toISOString(),
      JSON.stringify([TEST_BASELINE_INVARIANT_ID]),
    );
  expect([app.changes, extension.changes]).toEqual([1, 1]);
}

export async function createPgvectorSchema(connectionString: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    await client.query(
      'CREATE TABLE "user" (id integer NOT NULL, email text NOT NULL, PRIMARY KEY (id))',
    );
    await client.query('CREATE EXTENSION vector');
  });
}

export async function createPostgresTables(connectionString: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    await client.query(
      'CREATE TABLE "user" (id integer NOT NULL, email text NOT NULL, PRIMARY KEY (id))',
    );
    await client.query('CREATE TABLE test_box (x integer NOT NULL, y integer NOT NULL)');
  });
}
