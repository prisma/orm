import { rm } from 'node:fs/promises';
import { ok } from '@internal/utils/result';
import type { ErroredEnvelope, MountedTree, StreamEvent } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import { afterEach, beforeEach, type Mock, vi } from 'vitest';
import { BIN_GROUPS } from '../../src/orm/cli';
import { createContractPrintCommand } from '../../src/orm/contract/print';
import { createTestProjectDir } from '../utils/test-project-dir';

export const PSL = 'model User {\n  id Int @id\n}\n';

/**
 * The command is mounted from the factory with a printer double injected, and
 * the config's family creates an instance whose `printPslContract` is a
 * double, so no module mocking is involved and the doubles are scoped to the
 * test files that use them.
 */
export const mocks: Readonly<
  Record<
    'createFamilyInstance' | 'deserializeContract' | 'printPslContract' | 'printPsl' | 'load',
    Mock
  >
> = {
  createFamilyInstance: vi.fn(),
  deserializeContract: vi.fn(),
  printPslContract: vi.fn(),
  printPsl: vi.fn(),
  load: vi.fn(),
};

const commands: MountedTree = {
  'contract print': createContractPrintCommand({ printPsl: mocks.printPsl }),
};
const groups = BIN_GROUPS;

const dirs: string[] = [];

export async function projectDir(): Promise<string> {
  const dir = createTestProjectDir('orm-print');
  dirs.push(dir);
  return dir;
}

/** The contract the family instance returns once it has validated the loaded one. */
export const VALIDATED_CONTRACT = { roots: {}, domain: {}, validated: true };

const DESCRIPTOR = {
  familyId: 'sql',
  targetId: 'postgres',
  version: '1.0.0',
  create: () => ({}),
};

export function ormConfig(
  dir: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: mocks.createFamilyInstance,
    },
    target: {
      ...DESCRIPTOR,
      kind: 'target',
      id: 'postgres',
      contractSerializer: { serializeContract: (contract: unknown) => contract },
    },
    adapter: { ...DESCRIPTOR, kind: 'adapter', id: 'pg' },
    driver: { ...DESCRIPTOR, kind: 'driver', id: 'pg-driver' },
    contract: {
      source: { format: 'psl', inputs: ['./prisma/schema.prisma'], load: mocks.load },
      output: join(dir, 'generated', 'contract.json'),
    },
    ...overrides,
  };
}

export function harness(config: Record<string, unknown>) {
  return createTestCli({ commands, groups, config: { orm: config } });
}

export function erroredEnvelope(run: { readonly json: readonly StreamEvent[] }): ErroredEnvelope {
  const terminal = run.json.at(-1);
  if (terminal === undefined || terminal.kind !== 'result' || terminal.envelope.ok) {
    throw new Error('the run did not settle as an errored envelope');
  }
  return terminal.envelope;
}

/** Resets the doubles before each test and removes the project directories after it. */
export function useContractPrintDoubles(): void {
  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    mocks.printPslContract
      .mockReset()
      .mockReturnValue({ document: { kind: 'psl-document' }, sourceSettings: {} });
    mocks.deserializeContract.mockReset().mockReturnValue(VALIDATED_CONTRACT);
    mocks.createFamilyInstance.mockReset().mockReturnValue({
      deserializeContract: mocks.deserializeContract,
      printPslContract: mocks.printPslContract,
    });
    mocks.printPsl.mockReset().mockReturnValue(PSL);
    mocks.load.mockReset().mockResolvedValue(ok({ roots: {}, domain: {} }));
  });
}
