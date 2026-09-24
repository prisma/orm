import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { PrismaNextConfig } from '@internal/config/config-types';
import { ok } from '@internal/utils/result';
import { structuredError } from '@internal/utils/structured-error';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeContractEmit } from '../../src/control-api/operations/contract-emit';
import { executeContractPrint } from '../../src/control-api/operations/contract-print';

const malformed = structuredError(
  'CONTRACT.VALIDATION_FAILED',
  'Contract structural validation failed: domain.namespaces.public.models.User.fields must be an object',
  { meta: { path: 'domain.namespaces.public.models.User.fields' } },
);

const DESCRIPTOR = { version: '0.0.1', familyId: 'sql', targetId: 'postgres' };

function configWithMalformedContract(output: string) {
  const familyInstance = {
    deserializeContract: vi.fn(() => {
      throw malformed;
    }),
    printPslContract: vi.fn(),
  };
  const config = {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      emission: {},
      create: () => familyInstance,
    },
    target: {
      ...DESCRIPTOR,
      kind: 'target',
      id: 'postgres',
      contractSerializer: { serializeContract: (contract: unknown) => contract },
    },
    adapter: { ...DESCRIPTOR, kind: 'adapter', id: 'postgres' },
    extensions: [],
    contract: {
      source: {
        format: 'typescript',
        load: async () => ok({ domain: { namespaces: {} }, capabilities: {}, extensions: {} }),
      },
      output,
    },
  } as unknown as PrismaNextConfig;
  return { config, familyInstance };
}

describe('executeContractPrint', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'contract-print-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects a malformed contract with the error contract emit reports, before printing', async () => {
    const { config, familyInstance } = configWithMalformedContract(join(dir, 'contract.json'));
    const contractConfig = config.contract;
    if (contractConfig === undefined) throw new Error('the config has a contract section');

    await expect(executeContractEmit({ config, cwd: dir })).rejects.toBe(malformed);
    await expect(
      executeContractPrint({ config, contractConfig, description: 'printed' }),
    ).rejects.toBe(malformed);
    expect(familyInstance.printPslContract).not.toHaveBeenCalled();
  });
});
