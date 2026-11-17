/**
 * Multi-extension monorepo end-to-end against PGlite.
 *
 * Drives the aggregate `db init` flow (`ControlClient.dbInit`) against
 * PGlite (via `createDevDatabase`) with **two** internal extension
 * packages (`audit`, `feature-flags`) plus the application's own
 * contract. The structurally novel property under test here is
 * **plurality**: the framework treats N>1 contract-space contributors
 * uniformly, regardless of whether they ship as out-of-tree
 * extensions, in-tree extension packages, or internal monorepo
 * packages.
 *
 * Layers of coverage:
 *
 *   1. **Pinned per-space artifacts on disk.** After
 *      `emitContractSpaceArtifacts` runs for both extension spaces, the
 *      consuming app's repo carries `migrations/audit/{contract.json,
 *      contract.d.ts, refs/head.json}` and the same triple under
 *      `migrations/feature-flags/`.
 *
 *   2. **Planning across three spaces.** Calling
 *      `dbInit` with `mode: 'plan'` produces a plan whose ops
 *      are ordered alphabetically by space id (extensions first, app
 *      last) per `concatenateSpaceApplyInputs`. The audit
 *      `CREATE TABLE audit_event` op precedes the feature-flags
 *      `CREATE TABLE feature_flag` op (both are extension-space and
 *      sort by space id), and both precede the app-space User-table
 *      op.
 *
 *   3. **Apply across three spaces.** Same wiring as test
 *      (2) with `mode: 'apply'`. Asserts:
 *
 *        - all three tables (`audit_event`, `feature_flag`, the app
 *          `User`-equivalent) exist in `public`;
 *        - the marker table has rows for `app`, `audit`, and
 *          `feature-flags`;
 *        - each marker row carries the expected `core_hash` and the
 *          expected `applied_invariants`;
 *        - insert + select round-trip works against each table
 *          (proving the apply path actually ran the DDL, not just
 *          updated the marker).
 *
 *   4. **Order-independent across `extensions` declaration order
 *      .** Re-running the apply path with the extensions
 *      declared in reverse order produces the same marker hashes —
 *      cross-space ordering is determined by space id, not by
 *      declaration order.
 *
 * The fixtures (`audit*`, `featureFlags*`) are pulled from each
 * package's descriptor `contractSpace` rather than from
 * (now-deleted) per-package `contract.ts` / `migrations.ts` modules —
 * each internal package now authors via the on-disk
 * `prisma contract emit` / `prisma migration plan` pipeline,
 * and the descriptor is the canonical reader of those artifacts.
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MigrationPackage } from '@prisma/orm-postgres/components/control';
import { type ControlClient, createPostgresControlClient } from '@prisma/orm-postgres/control';
import { materialiseMigrationPackage } from '@prisma/orm-postgres/migration-tools/io';
import { emitContractSpaceArtifacts } from '@prisma/orm-postgres/migration-tools/spaces';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_USER_TABLE } from '../app/src/constants';
import appContractJson from '../app/src/contract.json' with { type: 'json' };

const APP_CONTRACT_HASH_VALUE = appContractJson.storage.storageHash;

import {
  AUDIT_BASELINE_INVARIANT_ID,
  AUDIT_EVENT_TABLE,
  AUDIT_SPACE_ID,
} from '../packages/audit/src/constants';
import auditExtensionDescriptor from '../packages/audit/src/control';
import {
  FEATURE_FLAG_TABLE,
  FEATURE_FLAGS_BASELINE_INVARIANT_ID,
  FEATURE_FLAGS_SPACE_ID,
} from '../packages/feature-flags/src/constants';
import featureFlagsExtensionDescriptor from '../packages/feature-flags/src/control';

function requireBaseline(
  descriptor: { readonly contractSpace?: { readonly migrations: readonly MigrationPackage[] } },
  spaceId: string,
): MigrationPackage {
  const baseline = descriptor.contractSpace?.migrations[0];
  if (!baseline) {
    throw new Error(`${spaceId} descriptor is missing its baseline migration package`);
  }
  return baseline;
}

const auditContractSpace = auditExtensionDescriptor.contractSpace;
if (!auditContractSpace) {
  throw new Error('audit descriptor is missing its contractSpace');
}
const auditBaselineMigration: MigrationPackage = requireBaseline(auditExtensionDescriptor, 'audit');
const auditContract = auditContractSpace.contractJson;
const AUDIT_STORAGE_HASH = auditContractSpace.headRef.hash;
const auditHeadRef = auditContractSpace.headRef;

const featureFlagsContractSpace = featureFlagsExtensionDescriptor.contractSpace;
if (!featureFlagsContractSpace) {
  throw new Error('feature-flags descriptor is missing its contractSpace');
}
const featureFlagsBaselineMigration: MigrationPackage = requireBaseline(
  featureFlagsExtensionDescriptor,
  'feature-flags',
);
const featureFlagsContract = featureFlagsContractSpace.contractJson;
const FEATURE_FLAGS_STORAGE_HASH = featureFlagsContractSpace.headRef.hash;
const featureFlagsHeadRef = featureFlagsContractSpace.headRef;

function createClient(connection: string, declarationOrder: 'natural' | 'reverse'): ControlClient {
  const extensions =
    declarationOrder === 'natural'
      ? [auditExtensionDescriptor, featureFlagsExtensionDescriptor]
      : [featureFlagsExtensionDescriptor, auditExtensionDescriptor];
  return createPostgresControlClient({ connection, extensions });
}

interface TestProject {
  readonly projectRoot: string;
  readonly migrationsDir: string;
}

async function setupTestProject(): Promise<TestProject> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'multi-extension-monorepo-'));
  const migrationsDir = join(projectRoot, 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  await emitContractSpaceArtifacts(migrationsDir, AUDIT_SPACE_ID, {
    contract: auditContract,
    contractDts: '// rendered .d.ts for audit contract space\nexport interface Contract {}\n',
    headRef: { hash: auditHeadRef.hash, invariants: [...auditHeadRef.invariants] },
  });
  const auditSpaceDir = join(migrationsDir, AUDIT_SPACE_ID);
  await materialiseMigrationPackage(auditSpaceDir, auditBaselineMigration);

  await emitContractSpaceArtifacts(migrationsDir, FEATURE_FLAGS_SPACE_ID, {
    contract: featureFlagsContract,
    contractDts:
      '// rendered .d.ts for feature-flags contract space\nexport interface Contract {}\n',
    headRef: {
      hash: featureFlagsHeadRef.hash,
      invariants: [...featureFlagsHeadRef.invariants],
    },
  });
  const featureFlagsSpaceDir = join(migrationsDir, FEATURE_FLAGS_SPACE_ID);
  await materialiseMigrationPackage(featureFlagsSpaceDir, featureFlagsBaselineMigration);

  return { projectRoot, migrationsDir };
}

describe('multi-extension-monorepo end-to-end (PGlite)', {
  concurrent: false,
  timeout: timeouts.spinUpPpgDev,
}, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let client: ControlClient | undefined;
  let project: TestProject | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  beforeEach(async () => {
    await withClient(database.connectionString, async (pg) => {
      await pg.query('drop schema if exists public cascade');
      await pg.query('drop schema if exists prisma_contract cascade');
      await pg.query('create schema public');
    });
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (client) {
      await client.close();
      client = undefined;
    }
    if (project) {
      await rm(project.projectRoot, { recursive: true, force: true });
      project = undefined;
    }
  }, timeouts.spinUpPpgDev);

  it('pinned per-space artifacts land for both extension spaces', async () => {
    project = await setupTestProject();

    const auditHeadJson = JSON.parse(
      await readFile(join(project.migrationsDir, AUDIT_SPACE_ID, 'refs', 'head.json'), 'utf-8'),
    );
    expect(auditHeadJson.hash).toBe(AUDIT_STORAGE_HASH);
    expect(auditHeadJson.invariants).toEqual([AUDIT_BASELINE_INVARIANT_ID]);

    const featureFlagsHeadJson = JSON.parse(
      await readFile(
        join(project.migrationsDir, FEATURE_FLAGS_SPACE_ID, 'refs', 'head.json'),
        'utf-8',
      ),
    );
    expect(featureFlagsHeadJson.hash).toBe(FEATURE_FLAGS_STORAGE_HASH);
    expect(featureFlagsHeadJson.invariants).toEqual([FEATURE_FLAGS_BASELINE_INVARIANT_ID]);

    const auditOps = JSON.parse(
      await readFile(
        join(project.migrationsDir, AUDIT_SPACE_ID, auditBaselineMigration.dirName, 'ops.json'),
        'utf-8',
      ),
    ) as ReadonlyArray<{ readonly invariantId?: string }>;
    expect(auditOps.find((op) => op.invariantId === AUDIT_BASELINE_INVARIANT_ID)).toBeDefined();

    const featureFlagsOps = JSON.parse(
      await readFile(
        join(
          project.migrationsDir,
          FEATURE_FLAGS_SPACE_ID,
          featureFlagsBaselineMigration.dirName,
          'ops.json',
        ),
        'utf-8',
      ),
    ) as ReadonlyArray<{ readonly invariantId?: string }>;
    expect(
      featureFlagsOps.find((op) => op.invariantId === FEATURE_FLAGS_BASELINE_INVARIANT_ID),
    ).toBeDefined();
  });

  it('mode=plan produces a plan across spaces ordered alphabetically (extensions first, app last)', async () => {
    project = await setupTestProject();

    client = createClient(database.connectionString, 'natural');
    const result = await client.dbInit({
      invocation: { cwd: process.cwd(), configPath: undefined, dbGiven: false },
      contract: appContractJson,
      mode: 'plan',
      migrationsDir: project.migrationsDir,
    });

    if (!result.ok) {
      throw new Error(
        `Expected plan ok but got failure: ${JSON.stringify(result.failure, null, 2)}`,
      );
    }
    const opIdsInOrder = result.value.plan.operations.map((op: { readonly id: string }) => op.id);

    const auditIdx = opIdsInOrder.findIndex((id: string) =>
      id.includes(`audit.create-${AUDIT_EVENT_TABLE}`),
    );
    const featureFlagsIdx = opIdsInOrder.findIndex((id: string) =>
      id.includes(`feature-flags.create-${FEATURE_FLAG_TABLE}`),
    );
    const appIdx = opIdsInOrder.findIndex((id: string) => id.includes(APP_USER_TABLE));

    expect(auditIdx).toBeGreaterThanOrEqual(0);
    expect(featureFlagsIdx).toBeGreaterThan(auditIdx);
    expect(appIdx).toBeGreaterThan(featureFlagsIdx);
  });

  it('mode=apply: three spaces apply atomically; markers + round-trips OK', async () => {
    project = await setupTestProject();

    client = createClient(database.connectionString, 'natural');
    const result = await client.dbInit({
      invocation: { cwd: process.cwd(), configPath: undefined, dbGiven: false },
      contract: appContractJson,
      mode: 'apply',
      migrationsDir: project.migrationsDir,
    });

    if (!result.ok) {
      throw new Error(
        `Expected db apply success but got failure: ${JSON.stringify(result.failure, null, 2)}`,
      );
    }

    await withClient(database.connectionString, async (pg) => {
      const markers = await pg.query<{
        space: string;
        core_hash: string;
        invariants: readonly string[];
      }>('select space, core_hash, invariants from prisma_contract.marker order by space');
      const markerBySpace = new Map(markers.rows.map((row) => [row.space, row]));

      expect([...markerBySpace.keys()].sort()).toEqual(
        ['app', AUDIT_SPACE_ID, FEATURE_FLAGS_SPACE_ID].sort(),
      );

      expect(markerBySpace.get('app')?.core_hash).toBe(APP_CONTRACT_HASH_VALUE);
      expect(markerBySpace.get(AUDIT_SPACE_ID)?.core_hash).toBe(AUDIT_STORAGE_HASH);
      expect(markerBySpace.get(FEATURE_FLAGS_SPACE_ID)?.core_hash).toBe(FEATURE_FLAGS_STORAGE_HASH);

      expect([...(markerBySpace.get(AUDIT_SPACE_ID)?.invariants ?? [])].sort()).toEqual(
        [...auditHeadRef.invariants].sort(),
      );
      expect([...(markerBySpace.get(FEATURE_FLAGS_SPACE_ID)?.invariants ?? [])].sort()).toEqual(
        [...featureFlagsHeadRef.invariants].sort(),
      );

      const auditTable = await pg.query<{ exists: boolean }>(
        `select to_regclass('public."${AUDIT_EVENT_TABLE}"') is not null as exists`,
      );
      expect(auditTable.rows[0]?.exists).toBe(true);

      const featureFlagsTable = await pg.query<{ exists: boolean }>(
        `select to_regclass('public."${FEATURE_FLAG_TABLE}"') is not null as exists`,
      );
      expect(featureFlagsTable.rows[0]?.exists).toBe(true);

      const appTable = await pg.query<{ exists: boolean }>(
        `select to_regclass('public."${APP_USER_TABLE}"') is not null as exists`,
      );
      expect(appTable.rows[0]?.exists).toBe(true);

      await pg.query(
        `insert into public."${AUDIT_EVENT_TABLE}" ("id", "actor", "action") values ($1, $2, $3)`,
        ['evt-1', 'alice', 'login'],
      );
      const auditRows = await pg.query<{ id: string; actor: string; action: string }>(
        `select "id", "actor", "action" from public."${AUDIT_EVENT_TABLE}"`,
      );
      expect(auditRows.rows.length).toBe(1);
      expect(auditRows.rows[0]?.actor).toBe('alice');

      await pg.query(
        `insert into public."${FEATURE_FLAG_TABLE}" ("key", "enabled") values ($1, $2)`,
        ['dark-mode', true],
      );
      const featureFlagsRows = await pg.query<{ key: string; enabled: boolean }>(
        `select "key", "enabled" from public."${FEATURE_FLAG_TABLE}"`,
      );
      expect(featureFlagsRows.rows.length).toBe(1);
      expect(featureFlagsRows.rows[0]?.enabled).toBe(true);

      await pg.query(`insert into public."${APP_USER_TABLE}" ("id", "email") values ($1, $2)`, [
        'user-1',
        'alice@example.com',
      ]);
      const appRows = await pg.query<{ id: string; email: string }>(
        `select "id", "email" from public."${APP_USER_TABLE}"`,
      );
      expect(appRows.rows.length).toBe(1);
      expect(appRows.rows[0]?.email).toBe('alice@example.com');
    });
  });

  it('marker hashes are independent of `extensions` declaration order', async () => {
    project = await setupTestProject();

    client = createClient(database.connectionString, 'reverse');
    const result = await client.dbInit({
      invocation: { cwd: process.cwd(), configPath: undefined, dbGiven: false },
      contract: appContractJson,
      mode: 'apply',
      migrationsDir: project.migrationsDir,
    });

    if (!result.ok) {
      throw new Error(
        `Expected db apply success but got failure: ${JSON.stringify(result.failure, null, 2)}`,
      );
    }

    await withClient(database.connectionString, async (pg) => {
      const markers = await pg.query<{
        space: string;
        core_hash: string;
      }>('select space, core_hash from prisma_contract.marker order by space');
      const markerBySpace = new Map(markers.rows.map((row) => [row.space, row]));

      expect(markerBySpace.get(AUDIT_SPACE_ID)?.core_hash).toBe(AUDIT_STORAGE_HASH);
      expect(markerBySpace.get(FEATURE_FLAGS_SPACE_ID)?.core_hash).toBe(FEATURE_FLAGS_STORAGE_HASH);
      expect(markerBySpace.get('app')?.core_hash).toBe(APP_CONTRACT_HASH_VALUE);
    });
  });
});
