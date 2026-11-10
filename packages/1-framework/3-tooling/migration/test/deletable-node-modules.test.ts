/**
 * "Deletable `node_modules`" fixture.
 *
 * Locks in the property that the per-space verifier and runner **read
 * only the user's repo** — on-disk `contract.json` / `contract.d.ts` /
 * `refs/head.json` files under `migrations/<space-id>/` plus the live
 * marker rows. Neither helper imports the extension descriptor module,
 * so the absence of `node_modules` (or any other path that resolves the
 * descriptor) does not affect verify / apply outcomes.
 *
 * Scoped to the framework helpers
 * (`emitContractSpaceArtifacts` + `listContractSpaceDirectories` +
 * `verifyContractSpaces` + `concatenateSpaceApplyInputs`). The test
 * intentionally **does not import** the synthetic
 * `test-contract-space` fixture (today hosted under
 * `test/integration/test/contract-space-fixture/`) — that is the
 * point. The test invents a `'test-contract-space'` space id inline
 * and runs the helpers against on-disk artifacts on disk plus a fake set of
 * marker rows.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 *   — "Pinned per-space artifacts" / verifier reads only the user repo.
 */

import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Contract } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { canonicalizeJson } from '@internal/framework-components/utils';
import { createSqlContract } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadContractSpaceAggregate } from '../src/aggregate/loader';
import { verifyMigration } from '../src/aggregate/verifier';
import { concatenateSpaceApplyInputs } from '../src/concatenate-space-apply-inputs';
import { contractSnapshotDir } from '../src/contract-snapshot-store';
import {
  type ContractSpaceHeadRecord,
  emitContractSpaceArtifacts,
  listContractSpaceDirectories,
  type SpaceApplyInput,
  type SpaceMarkerRecord,
  verifyContractSpaces,
} from '../src/exports/spaces';
import { writeTestPackage } from './fixtures';

const TEST_SPACE_ID = 'test-contract-space';
const TEST_HEAD_HASH = '0000000000000000000000000000000000000000000000000000000000000abc';
const TEST_INVARIANT = 'test-contract-space:create-test_box-v1';

const testContract = {
  storage: { storageHash: TEST_HEAD_HASH },
  tables: { test_box: { columns: { x: 'int', y: 'int' } } },
};
const testContractDts =
  '// rendered .d.ts for the test contract space\nexport interface Contract {}\n';

interface ProjectFixture {
  readonly projectRoot: string;
  readonly projectMigrationsDir: string;
  readonly nodeModulesPath: string;
}

async function setupProjectWithTestSpace(): Promise<ProjectFixture> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'no-descriptor-'));
  const projectMigrationsDir = join(projectRoot, 'migrations');
  const nodeModulesPath = join(projectRoot, 'node_modules');

  // Stand-in for an installed extension package — the descriptor module
  // would normally live under `node_modules/<pkg>/...`. The test deletes
  // this directory before invoking the verifier to confirm the verifier
  // + runner succeed when the extension descriptor is not importable
  // (e.g. node_modules removed).
  await mkdir(join(nodeModulesPath, '@internal', 'synthetic-extension-stand-in'), {
    recursive: true,
  });

  await emitContractSpaceArtifacts(projectMigrationsDir, TEST_SPACE_ID, {
    contract: testContract,
    contractDts: testContractDts,
    headRef: { hash: TEST_HEAD_HASH, invariants: [TEST_INVARIANT] },
  });

  return { projectRoot, projectMigrationsDir, nodeModulesPath };
}

describe('per-space verifier + runner against a project with deleted node_modules', () => {
  let fixture: ProjectFixture;

  beforeEach(async () => {
    fixture = await setupProjectWithTestSpace();
    await rm(fixture.nodeModulesPath, { recursive: true, force: true });
    const remaining = await readdir(fixture.projectRoot);
    expect(remaining.includes('node_modules')).toBe(false);
  });

  afterEach(async () => {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  });

  it('listContractSpaceDirectories discovers the test space without descriptor access', async () => {
    const dirs = await listContractSpaceDirectories(fixture.projectMigrationsDir);
    expect(dirs).toEqual([TEST_SPACE_ID]);
  });

  it('verifyContractSpaces returns ok when on-disk artifacts + marker rows match — no descriptor needed', async () => {
    const spaceContractRaw = await readFile(
      join(contractSnapshotDir(fixture.projectMigrationsDir, TEST_HEAD_HASH), 'contract.json'),
      'utf-8',
    );
    expect(spaceContractRaw.trimEnd()).toBe(canonicalizeJson(testContract));

    const headRaw = await readFile(
      join(fixture.projectMigrationsDir, TEST_SPACE_ID, 'refs', 'head.json'),
      'utf-8',
    );
    const headJson = JSON.parse(headRaw) as ContractSpaceHeadRecord;

    const dirs = await listContractSpaceDirectories(fixture.projectMigrationsDir);
    const result = verifyContractSpaces({
      markerLocation: 'prisma_contract.marker',
      loadedSpaces: new Set(['app', TEST_SPACE_ID]),
      spaceDirsOnDisk: dirs,
      headRefsBySpace: new Map([[TEST_SPACE_ID, headJson]]),
      markerRowsBySpace: new Map<string, SpaceMarkerRecord>([
        [TEST_SPACE_ID, { hash: headJson.hash, invariants: [...headJson.invariants] }],
      ]),
    });

    expect(result.ok).toBe(true);
  });

  it('verifyContractSpaces flags hash drift on the test space, again without descriptor access', async () => {
    const dirs = await listContractSpaceDirectories(fixture.projectMigrationsDir);

    const driftedMarker: SpaceMarkerRecord = {
      hash: '00000000000000000000000000000000000000000000000000000000deadbeef',
      invariants: [TEST_INVARIANT],
    };

    const result = verifyContractSpaces({
      markerLocation: 'prisma_contract.marker',
      loadedSpaces: new Set(['app', TEST_SPACE_ID]),
      spaceDirsOnDisk: dirs,
      headRefsBySpace: new Map([
        [
          TEST_SPACE_ID,
          { hash: TEST_HEAD_HASH, invariants: [TEST_INVARIANT] } satisfies ContractSpaceHeadRecord,
        ],
      ]),
      markerRowsBySpace: new Map([[TEST_SPACE_ID, driftedMarker]]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: 'hashMismatch',
        spaceId: TEST_SPACE_ID,
      }),
    );
  });

  it('concatenateSpaceApplyInputs orders the test space ahead of app — driven by on-disk inputs only', () => {
    const appInput: SpaceApplyInput<{ readonly id: string }> = {
      spaceId: 'app',
      migrationDirectory: fixture.projectMigrationsDir,
      currentMarkerHash: null,
      currentMarkerInvariants: [],
      path: [{ id: 'app-create-table' }],
    };
    const testSpaceInput: SpaceApplyInput<{ readonly id: string }> = {
      spaceId: TEST_SPACE_ID,
      migrationDirectory: join(fixture.projectMigrationsDir, TEST_SPACE_ID),
      currentMarkerHash: null,
      currentMarkerInvariants: [],
      path: [{ id: 'test-contract-space-create-test_box' }],
    };

    const ordered = concatenateSpaceApplyInputs([appInput, testSpaceInput]);
    expect(ordered.map((i) => i.spaceId)).toEqual([TEST_SPACE_ID, 'app']);
  });
});

/**
 * Lock for the loader → planner → verifier pipeline.
 *
 * The aggregate refactor makes the loader the single
 * descriptor-import boundary for `db init` / `db update` / `db verify`:
 * once `loadContractSpaceAggregate` returns, the planner and verifier
 * operate purely on the in-memory aggregate. This test exercises that
 * property end-to-end: with `node_modules` deleted, declared extension
 * entries supplied **inline** (the same shape `cli/control-api/utils/contract-space-aggregate-loader`
 * builds from `Config.extensions`), the full pipeline succeeds.
 *
 * The test deliberately constructs `DeclaredExtensionEntry` values
 * directly — no descriptor module is imported. If the post-load
 * pipeline ever silently re-touches a descriptor module, this test
 * does not catch it on its own (descriptor modules are imported
 * eagerly by their consumers); but combined with the fact that the
 * loader's only descriptor-shaped input is `id` / `targetId`, the
 * property is locked at the API surface.
 */
describe('aggregate pipeline (loader → planner → verifier) against deleted node_modules', () => {
  let projectRoot: string;
  let migrationsDir: string;
  let headHash: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'no-descriptor-pipeline-'));
    migrationsDir = join(projectRoot, 'migrations');
    // Stand-in for an installed extension package; deleted before
    // walking the pipeline.
    await mkdir(join(projectRoot, 'node_modules', '@internal', 'extension-test-contract-space'), {
      recursive: true,
    });

    // Pin the contract-space artifacts the loader reads. The contract
    // value here is the same shape the validator will return.
    const spaceContract = createSqlContract({
      target: 'postgres',
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: { test_box: { columns: { x: {}, y: {} } } },
            },
          },
        },
      },
    });
    headHash = spaceContract.storage.storageHash;
    await emitContractSpaceArtifacts(migrationsDir, TEST_SPACE_ID, {
      contract: spaceContract as unknown as Record<string, unknown>,
      contractDts: '// rendered .d.ts\nexport interface Contract {}\n',
      headRef: { hash: headHash, invariants: [] },
    });

    // Baseline migration package — single edge from null → headHash —
    // so reconstructGraph finds a path from EMPTY_CONTRACT_HASH.
    await writeTestPackage(join(migrationsDir, TEST_SPACE_ID, '20260225_baseline'), {
      from: null,
      to: headHash,
    });

    await rm(join(projectRoot, 'node_modules'), { recursive: true, force: true });
    const remaining = await readdir(projectRoot);
    expect(remaining.includes('node_modules')).toBe(false);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('loader → verifier walk to completion with node_modules removed', async () => {
    const appContract = createSqlContract({
      target: 'postgres',
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: { user: { columns: { id: {} } } },
            },
          },
        },
      },
    });

    const aggregate = await loadContractSpaceAggregate({
      migrationsDir,
      appContract,
      deserializeContract: (json: unknown): Contract => json as Contract,
    });
    expect(aggregate.app.spaceId).toBe('app');
    expect(aggregate.extensions.map((e) => e.spaceId)).toEqual([TEST_SPACE_ID]);

    // Verifier runs without descriptor access — schemaIntrospection and
    // markerRows would in production come from the live DB; here a
    // synthetic shape exercises the pipeline.
    const verifyResult = verifyMigration({
      aggregate,
      markersBySpaceId: new Map(),
      schemaIntrospection: { tables: { user: { columns: {} }, test_box: { columns: {} } } },
      mode: 'lenient',
      verifySchemaForSpace: () => ({
        ok: true,
        summary: 'Database schema satisfies contract',
        contract: { storageHash: 'test' },
        target: { expected: 'postgres' },
        schema: {
          issues: [],
        },
        timings: { total: 0 },
      }),
    });
    expect(verifyResult.ok).toBe(true);
    if (!verifyResult.ok) return;
    expect(verifyResult.value.markerCheck.perSpace.get('app')).toEqual({ kind: 'absent' });
    expect(verifyResult.value.markerCheck.perSpace.get(TEST_SPACE_ID)).toEqual({ kind: 'absent' });
    expect(verifyResult.value.schemaCheck.perSpace.get('app')?.ok).toBe(true);
  });
});
