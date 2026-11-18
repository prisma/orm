import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { notOk } from '@internal/utils/result';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HASH_TO, harness } from './fixtures/migration-plan-project';
import {
  contractJson,
  contractWithoutTypesModule,
  createOfflineProject,
  removeOfflineProjects,
  renderContractDtsMock,
  resetRenderContractDtsMock,
  SNAPSHOT_CONTRACT_DTS,
} from './fixtures/offline-project';

beforeEach(resetRenderContractDtsMock);
afterEach(removeOfflineProjects);

describe('migration new destination snapshot', () => {
  it('writes the destination snapshot with declarations rendered from the emitted contract', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const run = await harness(project).run(['migration', 'new', '--name', 'rendered', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(renderContractDtsMock).toHaveBeenCalledWith({
      contract: contractJson(HASH_TO),
      typesModule: '@acme/orm-db/contract-types',
    });
    const storeDir = contractSnapshotDir(project.migrationsDir, HASH_TO);
    expect(await readFile(join(storeDir, 'contract.d.ts'), 'utf-8')).toBe(SNAPSHOT_CONTRACT_DTS);
  });

  it('refuses before writing anything when the declarations cannot be rendered', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    renderContractDtsMock.mockResolvedValue(
      notOk({
        code: 'RENDER_FAILED',
        summary: 'Failed to render contract types',
        why: 'relation author must declare nullability',
      }),
    );

    const run = await harness(project).run(['migration', 'new', '--name', 'refused', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CONTRACT.TYPES_RENDER_FAILED' } },
    });
    expect(existsSync(project.appMigrationsDir)).toBe(false);
    expect(existsSync(contractSnapshotDir(project.migrationsDir, HASH_TO))).toBe(false);
  });
});

describe('migration new without a migration module', () => {
  it('refuses before writing anything, naming the missing member', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const run = await harness(project, { overrides: { migrations: {} } }).run(
      ['migration', 'new', '--name', 'refused', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CONFIG.MIGRATION_MODULE_MISSING' } },
    });
    expect(existsSync(project.appMigrationsDir)).toBe(false);
    expect(existsSync(contractSnapshotDir(project.migrationsDir, HASH_TO))).toBe(false);
  });
});

describe('migration new without a contract types module', () => {
  it('refuses before writing anything, naming the missing member', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const run = await harness(project, {
      overrides: { contract: contractWithoutTypesModule(project) },
    }).run(['migration', 'new', '--name', 'refused', '--json'], { cwd: project.dir });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'CONFIG.CONTRACT_TYPES_MODULE_MISSING',
          why: expect.stringContaining('contract.typesModule'),
        },
      },
    });
    expect(existsSync(project.appMigrationsDir)).toBe(false);
    expect(existsSync(contractSnapshotDir(project.migrationsDir, HASH_TO))).toBe(false);
  });
});
