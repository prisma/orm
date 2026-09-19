import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { errorInvalidRefName, MigrationToolsError } from '@internal/migration-tools/errors';
import { notOk, ok } from '@internal/utils/result';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  advanceRefSafely,
  buildRefAdvancementFields,
  type ContractIR,
  computeRefAdvancementName,
  executeRefAdvancement,
  preflightRefAdvancement,
} from '../../src/control-api/operations/ref-advancement';
import type { RenderContractDtsResult } from '../../src/control-api/render-contract-dts';
import { createTestProjectDir, writeProjectManifest } from '../utils/test-project-dir';

const HASH_A = `${'a'.repeat(64)}`;
const PROFILE_HASH = `${'c'.repeat(64)}`;

function sampleContractIR(storageHash: string = HASH_A): ContractIR {
  return {
    contract: {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      profileHash: PROFILE_HASH,
      storage: { storageHash },
      models: {
        User: {
          fields: {
            id: {
              nullable: false,
              type: { kind: 'scalar', codecId: 'sql/int4@1' },
            },
          },
          relations: {},
          storage: { namespaceId: '__unbound__', table: 'users', namespace: 'public' },
        },
      },
      roots: {},
    },
    contractDts: '// generated\nexport type Contract = unknown;\n',
  };
}

function refPointerPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.json`);
}

describe('computeRefAdvancementName', () => {
  it('returns the explicit name when advanceRef is set without db', () => {
    expect(computeRefAdvancementName({ advanceRef: 'staging' })).toBe('staging');
  });

  it('returns the explicit name when advanceRef is set with db', () => {
    expect(
      computeRefAdvancementName({ advanceRef: 'staging', db: 'postgres://localhost/db' }),
    ).toBe('staging');
  });

  it('returns db when advanceRef is omitted and db is omitted', () => {
    expect(computeRefAdvancementName({})).toBe('db');
  });

  it('returns null when advanceRef is omitted and db is provided', () => {
    expect(computeRefAdvancementName({ db: 'postgres://localhost/db' })).toBe(null);
  });

  it('returns db when advanceRef is explicitly db on the default database', () => {
    expect(computeRefAdvancementName({ advanceRef: 'db' })).toBe('db');
  });
});

describe('executeRefAdvancement', () => {
  let migrationsDir: string;
  let refsDir: string;

  beforeEach(async () => {
    migrationsDir = createTestProjectDir('ref-advancement');
    refsDir = join(migrationsDir, 'app', 'refs');
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('writes the store entry and pointer, returning the advanced ref', async () => {
    expect(existsSync(refsDir)).toBe(false);

    const result = await executeRefAdvancement(
      refsDir,
      migrationsDir,
      'db',
      HASH_A,
      sampleContractIR(),
    );

    expect(result).toEqual({ name: 'db', hash: HASH_A });
    expect(existsSync(refPointerPath(refsDir, 'db'))).toBe(true);
    expect(existsSync(join(contractSnapshotDir(migrationsDir, HASH_A), 'contract.json'))).toBe(
      true,
    );
    expect(existsSync(join(contractSnapshotDir(migrationsDir, HASH_A), 'contract.d.ts'))).toBe(
      true,
    );
  });

  it('is a write-if-absent no-op on the store when advancing to the same hash again', async () => {
    await executeRefAdvancement(refsDir, migrationsDir, 'db', HASH_A, sampleContractIR());
    const storeJsonPath = join(contractSnapshotDir(migrationsDir, HASH_A), 'contract.json');
    const firstContent = await readFile(storeJsonPath, 'utf-8');

    await executeRefAdvancement(refsDir, migrationsDir, 'db', HASH_A, sampleContractIR());
    const secondContent = await readFile(storeJsonPath, 'utf-8');

    expect(secondContent).toBe(firstContent);
  });

  it('propagates a hash mismatch between the argument and the contract IR from the store write', async () => {
    const HASH_B = 'b'.repeat(64);
    await expect(
      executeRefAdvancement(refsDir, migrationsDir, 'db', HASH_A, sampleContractIR(HASH_B)),
    ).rejects.toSatisfy((error) => {
      expect(MigrationToolsError.is(error)).toBe(true);
      expect((error as MigrationToolsError).code).toBe('MIGRATION.CONTRACT_SNAPSHOT_HASH_MISMATCH');
      return true;
    });
    expect(existsSync(refPointerPath(refsDir, 'db'))).toBe(false);
  });

  it('surfaces MIGRATION.INVALID_REF_NAME for an invalid ref name without writing a store entry', async () => {
    await expect(
      executeRefAdvancement(refsDir, migrationsDir, '', HASH_A, sampleContractIR()),
    ).rejects.toSatisfy((error) => {
      expect(MigrationToolsError.is(error)).toBe(true);
      expect((error as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_NAME');
      return true;
    });
    expect(existsSync(contractSnapshotDir(migrationsDir, HASH_A))).toBe(false);
  });
});

describe('preflightRefAdvancement', () => {
  const contractJson = sampleContractIR().contract as Record<string, unknown>;
  let projectDir: string;
  let contractJsonPath: string;
  let configPath: string;

  beforeEach(() => {
    projectDir = createTestProjectDir('preflight-ref-advancement');
    writeProjectManifest(projectDir);
    contractJsonPath = join(projectDir, 'output', 'contract.json');
    configPath = join(projectDir, 'prisma.config.ts');
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });
  const RENDERED = '// rendered\nexport type Contract = { rendered: true };\n';

  function fakeClient(result: RenderContractDtsResult) {
    return { renderContractDts: vi.fn().mockResolvedValue(result) };
  }

  it('returns the contract with the declarations the client renders for it', async () => {
    const client = fakeClient(ok({ contractDts: RENDERED }));

    const result = await preflightRefAdvancement({
      name: 'db',
      contractJson,
      contractJsonPath,
      configPath,
      client,
    });

    expect(result).toEqual(ok({ contract: contractJson, contractDts: RENDERED }));
    expect(client.renderContractDts).toHaveBeenCalledWith({
      contract: contractJson,
      resolveImportSpecifier: expect.any(Function),
    });
  });

  it('refuses an invalid ref name without rendering', async () => {
    const client = fakeClient(ok({ contractDts: RENDERED }));

    const result = await preflightRefAdvancement({
      name: 'Invalid Name',
      contractJson,
      contractJsonPath,
      configPath,
      client,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.toEnvelope()).toEqual(errorInvalidRefName('Invalid Name').toEnvelope());
    }
    expect(client.renderContractDts).not.toHaveBeenCalled();
  });

  it('reports a contract the family rejects as a validation failure at the contract path', async () => {
    const client = fakeClient(
      notOk({
        code: 'CONTRACT_VALIDATION_FAILED',
        summary: 'Contract validation failed',
        why: 'storage.storageHash must be a string',
      }),
    );

    const result = await preflightRefAdvancement({
      name: 'db',
      contractJson,
      contractJsonPath,
      configPath,
      client,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.toEnvelope()).toMatchObject({
        code: 'CONTRACT.VALIDATION_FAILED',
        why: expect.stringContaining('storage.storageHash must be a string'),
        where: { path: contractJsonPath },
      });
    }
  });

  it('reports a contract the emitter refuses with a contract emit fix', async () => {
    const client = fakeClient(
      notOk({
        code: 'RENDER_FAILED',
        summary: 'Failed to render contract types',
        why: 'relation author must declare nullability',
      }),
    );

    const result = await preflightRefAdvancement({
      name: 'db',
      contractJson,
      contractJsonPath,
      configPath,
      client,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.toEnvelope()).toMatchObject({
        code: 'CONTRACT.TYPES_RENDER_FAILED',
        why: expect.stringContaining('relation author must declare nullability'),
        fix: expect.stringContaining('contract emit'),
        where: { path: contractJsonPath },
      });
    }
  });
});

describe('buildRefAdvancementFields', () => {
  let migrationsDir: string;
  let refsDir: string;

  beforeEach(() => {
    migrationsDir = createTestProjectDir('build-ref-advancement');
    refsDir = join(migrationsDir, 'app', 'refs');
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('plans without writing in plan mode', async () => {
    const result = await buildRefAdvancementFields({
      name: 'staging',
      refsDir,
      migrationsDir,
      contractIR: sampleContractIR(),
      mode: 'plan',
      hash: HASH_A,
    });

    expect(result).toEqual(
      ok({ advancedRef: null, plannedAdvanceRef: { name: 'staging', hash: HASH_A } }),
    );
    expect(existsSync(refPointerPath(refsDir, 'staging'))).toBe(false);
  });

  it('advances the ref in apply mode, writing store entry and pointer', async () => {
    const contractIR = sampleContractIR();

    const result = await buildRefAdvancementFields({
      name: 'staging',
      refsDir,
      migrationsDir,
      contractIR,
      mode: 'apply',
      hash: HASH_A,
    });

    expect(result).toEqual(
      ok({ advancedRef: { name: 'staging', hash: HASH_A }, plannedAdvanceRef: null }),
    );
    expect(existsSync(refPointerPath(refsDir, 'staging'))).toBe(true);
    const storeDir = contractSnapshotDir(migrationsDir, HASH_A);
    expect(existsSync(join(storeDir, 'contract.json'))).toBe(true);
    expect(await readFile(join(storeDir, 'contract.d.ts'), 'utf-8')).toBe(contractIR.contractDts);
  });

  it('maps a hash mismatch between the argument and the contract to the MigrationToolsError envelope', async () => {
    const result = await buildRefAdvancementFields({
      name: 'staging',
      refsDir,
      migrationsDir,
      contractIR: sampleContractIR('b'.repeat(64)),
      mode: 'apply',
      hash: HASH_A,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('MIGRATION.CONTRACT_SNAPSHOT_HASH_MISMATCH');
    }
    expect(existsSync(refPointerPath(refsDir, 'staging'))).toBe(false);
  });
});

describe('advanceRefSafely', () => {
  let migrationsDir: string;
  let refsDir: string;

  beforeEach(() => {
    migrationsDir = createTestProjectDir('advance-ref-safely');
    refsDir = join(migrationsDir, 'app', 'refs');
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('advances the named ref and returns its name and hash', async () => {
    const result = await advanceRefSafely({
      refsDir,
      migrationsDir,
      name: 'production',
      hash: HASH_A,
      contractIR: sampleContractIR(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: 'production', hash: HASH_A });
    }
    expect(existsSync(refPointerPath(refsDir, 'production'))).toBe(true);
  });

  it('maps an invalid ref name to the MigrationToolsError envelope without writing', async () => {
    const result = await advanceRefSafely({
      refsDir,
      migrationsDir,
      name: '',
      hash: HASH_A,
      contractIR: sampleContractIR(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.toEnvelope()).toEqual(errorInvalidRefName('').toEnvelope());
    }
    expect(existsSync(contractSnapshotDir(migrationsDir, HASH_A))).toBe(false);
  });
});
