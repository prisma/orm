import { rm } from 'node:fs/promises';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { formatMigrationDirName, writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { blindCast } from '@internal/utils/casts';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createTestProjectDir } from '../utils/test-project-dir';

export const HASH_A = `4cb4256${'0'.repeat(57)}`;
export const HASH_B = `9f1e2d3${'0'.repeat(57)}`;
/** Well-formed, and deliberately not a node of the seeded graph. */
export const HASH_ABSENT = 'f'.repeat(64);

const ADDITIVE_OP = blindCast<
  MigrationPlanOperation,
  'The ref commands read only the graph edges a package declares'
>({ id: 'schema.add_column', label: 'Add column', operationClass: 'additive' });

const created: string[] = [];

export async function cleanupRefProjects(): Promise<void> {
  for (const dir of created.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function emptyProject(): Promise<string> {
  const dir = createTestProjectDir('orm-ref');
  created.push(dir);
  return dir;
}

export function ormConfig(): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({}),
    },
    target: {
      kind: 'target',
      id: 'postgres',
      familyId: 'sql',
      targetId: 'postgres',
      version: '1.0.0',
      create: () => ({}),
    },
    adapter: {
      kind: 'adapter',
      id: 'pg',
      familyId: 'sql',
      targetId: 'postgres',
      version: '1.0.0',
      create: () => ({}),
    },
  };
}

export function harness(config: Record<string, unknown> = ormConfig()) {
  return createTestCli({
    commands: BIN_COMMANDS,
    groups: BIN_GROUPS,
    config: { orm: config },
  });
}

export function refsDirIn(projectRoot: string, migrationsDirName = 'migrations'): string {
  return join(projectRoot, migrationsDirName, 'app', 'refs');
}

export function refPointerPath(
  projectRoot: string,
  name: string,
  migrationsDirName = 'migrations',
): string {
  return join(refsDirIn(projectRoot, migrationsDirName), `${name}.json`);
}

async function writeSeededMigration(
  migrationsDir: string,
  edge: {
    readonly from: string | null;
    readonly to: string;
    readonly slug: string;
    readonly at: Date;
  },
  options: { readonly withSnapshot: boolean },
): Promise<string> {
  const ops = [ADDITIVE_OP];
  const base = blindCast<
    Omit<MigrationMetadata, 'migrationHash'>,
    'The ref commands read only from/to, createdAt and providedInvariants'
  >({
    from: edge.from,
    to: edge.to,
    providedInvariants: [],
    createdAt: edge.at.toISOString(),
  });
  const metadata: MigrationMetadata = { ...base, migrationHash: computeMigrationHash(base, ops) };
  const dirName = formatMigrationDirName(edge.at, edge.slug);
  await writeMigrationPackage(join(migrationsDir, 'app', dirName), metadata, ops);
  if (options.withSnapshot) {
    await writeContractSnapshot(migrationsDir, edge.to, {
      contractJson: { storage: { storageHash: edge.to } },
      contractDts: 'export type Contract = unknown;\n',
    });
  }
  return dirName;
}

export interface RefProject {
  readonly dir: string;
  /** The baseline migration: no source contract, destination {@link HASH_A}. */
  readonly initialDirName: string;
  /** {@link HASH_A} → {@link HASH_B}. */
  readonly secondDirName: string;
}

/** A project with a two-edge graph, both destinations carrying a snapshot. */
export async function seedRefProject(migrationsDirName = 'migrations'): Promise<RefProject> {
  const dir = await emptyProject();
  const migrationsDir = join(dir, migrationsDirName);
  const initialDirName = await writeSeededMigration(
    migrationsDir,
    { from: null, to: HASH_A, slug: 'initial', at: new Date(2025, 0, 1, 10, 0) },
    { withSnapshot: true },
  );
  const secondDirName = await writeSeededMigration(
    migrationsDir,
    { from: HASH_A, to: HASH_B, slug: 'add_post', at: new Date(2025, 0, 2, 10, 0) },
    { withSnapshot: true },
  );
  return { dir, initialDirName, secondDirName };
}

/** A project whose graph forks at the empty database: one edge to {@link HASH_A}, one to {@link HASH_B}. */
export async function seedForkedRefProject(): Promise<string> {
  const dir = await emptyProject();
  const migrationsDir = join(dir, 'migrations');
  await writeSeededMigration(
    migrationsDir,
    { from: null, to: HASH_A, slug: 'left', at: new Date(2025, 0, 1, 10, 0) },
    { withSnapshot: true },
  );
  await writeSeededMigration(
    migrationsDir,
    { from: null, to: HASH_B, slug: 'right', at: new Date(2025, 0, 2, 10, 0) },
    { withSnapshot: true },
  );
  return dir;
}

/** A project whose only migration never had its contract snapshot written. */
export async function seedProjectMissingSnapshot(): Promise<string> {
  const dir = await emptyProject();
  await writeSeededMigration(
    join(dir, 'migrations'),
    { from: null, to: HASH_A, slug: 'initial', at: new Date(2025, 0, 1, 10, 0) },
    { withSnapshot: false },
  );
  return dir;
}
