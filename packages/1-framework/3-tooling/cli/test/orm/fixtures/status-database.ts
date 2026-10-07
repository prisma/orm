import { writeRef } from '@internal/migration-tools/refs';
import type { Diagnostic } from '@prisma/cli-engine/protocol';
import { join } from 'pathe';
import { BIN_COMMANDS, BIN_GROUPS } from '../../../src/orm/cli';
import { createOrmTestCli } from '../../helpers/orm-test-cli';
import {
  contractJson,
  createOfflineProject,
  type OfflineProject,
  offlineConfig,
  seedContractSnapshot,
  seedMigrationPackage,
} from './offline-project';

export const HASH_HEAD = `c0ffee${'0'.repeat(58)}`;
export const HASH_BASE = `beef${'1'.repeat(60)}`;
export const HASH_UNKNOWN = `dead${'2'.repeat(60)}`;
const CONNECTION = 'postgres://user:secret@localhost:5432/appdb';

interface FakeDatabaseScript {
  readonly markers?: ReadonlyMap<
    string,
    { readonly storageHash: string; readonly invariants: readonly string[] }
  >;
  readonly ledger?: ReadonlyArray<{ readonly migrationHash: string }>;
  readonly readMarkersError?: Error;
  readonly closeError?: Error;
}

/**
 * The database the real control client talks to: the family instance answers
 * marker and ledger reads from the script, and the driver descriptor counts
 * connections so tests can assert none was opened. No module mocks — the
 * command builds the real client over these descriptors.
 */
export function fakeDatabase(script: FakeDatabaseScript = {}) {
  const counters = { connections: 0, closes: 0 };
  const familyInstance = {
    deserializeContract: (json: unknown) => json,
    readAllMarkers: async () => {
      if (script.readMarkersError !== undefined) {
        throw script.readMarkersError;
      }
      return script.markers ?? new Map();
    },
    readLedger: async () => script.ledger ?? [],
  };
  const driver = {
    close: async () => {
      counters.closes += 1;
      if (script.closeError !== undefined) {
        throw script.closeError;
      }
    },
  };
  return { counters, familyInstance, driver };
}

type FakeDatabase = ReturnType<typeof fakeDatabase>;

export function driverConfig(
  project: OfflineProject,
  db: FakeDatabase = fakeDatabase(),
): Record<string, unknown> {
  const base = offlineConfig({ project });
  return {
    ...base,
    family: { ...(base['family'] as Record<string, unknown>), create: () => db.familyInstance },
    driver: {
      kind: 'driver',
      id: 'pg',
      familyId: 'sql',
      targetId: 'postgres',
      version: '1.0.0',
      create: async () => {
        db.counters.connections += 1;
        return db.driver;
      },
    },
    db: { connection: CONNECTION },
  };
}

export function harness(config: Record<string, unknown>) {
  return createOrmTestCli({ commands: BIN_COMMANDS, groups: BIN_GROUPS, orm: config });
}

/** A project whose app space carries one migration ∅ → HASH_HEAD. */
export async function projectWithOneMigration(): Promise<
  OfflineProject & { readonly migrationHash: string }
> {
  const project = await createOfflineProject({ storageHash: HASH_HEAD });
  const seeded = await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '20260101T0000_initial',
    from: null,
    to: HASH_HEAD,
  });
  return { ...project, migrationHash: seeded.migrationHash };
}

export const DIR_BASE = '20260101T0000_base';
export const DIR_HEAD = '20260102T0000_head';

/** A project whose app space carries ∅ → HASH_BASE → HASH_HEAD, with the contract at HASH_HEAD. */
export async function projectWithTwoMigrations(): Promise<
  OfflineProject & { readonly baseMigrationHash: string }
> {
  const project = await createOfflineProject({ storageHash: HASH_HEAD });
  const base = await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: DIR_BASE,
    from: null,
    to: HASH_BASE,
  });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: DIR_HEAD,
    from: HASH_BASE,
    to: HASH_HEAD,
  });
  return { ...project, baseMigrationHash: base.migrationHash };
}

export function markersAt(storageHash: string) {
  return new Map([['app', { storageHash, invariants: [] as readonly string[] }]]);
}

export const EXTERNAL_SPACE = 'external';
export const HASH_EXTERNAL_HEAD = `e0e0${'3'.repeat(60)}`;

/** An all-external extension space: a head ref on disk and no migration packages. */
export async function addAllExternalSpace(project: OfflineProject): Promise<void> {
  await writeRef(join(project.migrationsDir, EXTERNAL_SPACE, 'refs'), 'head', {
    hash: HASH_EXTERNAL_HEAD,
    invariants: [],
  });
  await seedContractSnapshot({
    migrationsDir: project.migrationsDir,
    storageHash: HASH_EXTERNAL_HEAD,
  });
}

function allExternalExtension(): Record<string, unknown> {
  return {
    kind: 'extension',
    id: EXTERNAL_SPACE,
    familyId: 'sql',
    targetId: 'postgres',
    version: '1.0.0',
    create: () => ({}),
    contractSpace: {
      contractJson: contractJson(HASH_EXTERNAL_HEAD),
      headRef: { hash: HASH_EXTERNAL_HEAD, invariants: [] },
      migrations: [],
    },
  };
}

export function withAllExternalExtension(config: Record<string, unknown>): Record<string, unknown> {
  return { ...config, extensions: [allExternalExtension()] };
}

export function markersWithExternalAtHead(appHash: string) {
  return new Map([
    ['app', { storageHash: appHash, invariants: [] as readonly string[] }],
    [EXTERNAL_SPACE, { storageHash: HASH_EXTERNAL_HEAD, invariants: [] as readonly string[] }],
  ]);
}

export function codesAndSeverities(
  diagnostics: readonly Diagnostic[],
): ReadonlyArray<{ code: string; severity: string }> {
  return diagnostics.map(({ code, severity }) => ({ code, severity }));
}
