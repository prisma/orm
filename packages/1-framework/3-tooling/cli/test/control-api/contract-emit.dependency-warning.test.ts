import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as configLoader from '@internal/config-loader';
import type { Contract } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeContractEmit } from '../../src/control-api/operations/contract-emit';
import { disposeEmitQueue } from '../../src/utils/emit-queue';

const emit = vi.fn<typeof import('@internal/emitter')['emit']>();

function spec(pkg: string, named: string) {
  return { package: `${pkg}/types`, named, alias: named };
}

function configDeclaringTypesFrom(output: string): configLoader.PrismaConfig {
  return blindCast<configLoader.PrismaConfig, 'a config of stub components'>({
    family: {
      id: 'family:test',
      version: '0.0.1',
      familyId: 'test-family',
      emission: {},
      create: () => ({ deserializeContract: vi.fn() }),
    },
    target: {
      kind: 'target',
      id: 'target:test',
      version: '0.0.1',
      familyId: 'test-family',
      targetId: 'test-target',
      contractSerializer: {
        serializeContract: (contract: unknown) => contract,
        deserializeContract: (json: unknown) => json,
      },
    },
    adapter: {
      kind: 'adapter',
      id: 'adapter:test',
      version: '0.0.1',
      familyId: 'test-family',
      targetId: 'test-target',
      types: {
        codecTypes: {
          import: spec('@missing/codec-package', 'CodecTypes'),
          typeImports: [spec('@missing/type-import-package', 'JsonValue')],
          parameterizedOutputTypes: spec('@missing/parameterized-package', 'Parameterized'),
        },
        queryOperationTypes: { import: spec('@missing/query-operation-package', 'Ops') },
      },
    },
    extensions: [],
    contract: {
      source: {
        format: 'typescript',
        load: async () => ({
          ok: true,
          value: blindCast<Contract, 'an empty contract'>({ capabilities: {}, extensions: {} }),
        }),
      },
      output,
      typesModule: '#contract-types',
    },
  });
}

describe('the dependency warning of contract emit', () => {
  let tmpDir = '';

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'contract-emit-dependency-warning-'));
    emit.mockReset();
  });

  afterEach(async () => {
    disposeEmitQueue(join(tmpDir, 'generated/contract.json'));
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('names every package the components declare a type import from that is not installed', async () => {
    emit.mockResolvedValueOnce({
      storageHash: 'storage',
      profileHash: 'profile',
      contractJson: '{}',
      contractDts: 'export {};\n',
    });

    const result = await executeContractEmit(
      {
        config: configDeclaringTypesFrom(join(tmpDir, 'generated/contract.json')),
        cwd: tmpDir,
      },
      { emit },
    );

    for (const pkg of [
      '@missing/codec-package',
      '@missing/type-import-package',
      '@missing/parameterized-package',
      '@missing/query-operation-package',
    ]) {
      expect(result.validationWarning).toContain(`  - ${pkg}\n`);
    }
  });
});
