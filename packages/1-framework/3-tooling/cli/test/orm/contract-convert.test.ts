import { existsSync } from 'node:fs';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { ErroredEnvelope, MountedTree, StreamEvent } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveContractSource } from '../../src/control-api/operations/contract-emit';
import { BIN_GROUPS } from '../../src/orm/cli';
import { createContractConvertCommand } from '../../src/orm/contract/convert';
import { createTestProjectDir } from '../utils/test-project-dir';

const PSL =
  '// use prisma-8\n// Converted from schema.prisma by `prisma contract convert`.\n\nmodel User {\n  id Int @id\n}\n';
const CONTRACT = { domain: {}, storage: {} };

/**
 * The command is mounted from the factory with a control-client double, a
 * source-loader double, and a printer double injected; no module mocking.
 */
const mocks = {
  printPslContract: vi.fn(),
  getPslBlockDescriptors: vi.fn(),
  close: vi.fn(),
  resolveContractSource: vi.fn(),
  printPsl: vi.fn(),
};

const commands: MountedTree = {
  'contract convert': createContractConvertCommand({
    createControlClient: () => ({
      printPslContract: mocks.printPslContract,
      getPslBlockDescriptors: mocks.getPslBlockDescriptors,
      close: mocks.close,
    }),
    resolveContractSource: mocks.resolveContractSource,
    printPsl: mocks.printPsl,
  }),
};
const groups = BIN_GROUPS;

const dirs: string[] = [];

async function projectDir(): Promise<string> {
  const dir = createTestProjectDir('orm-convert');
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  mocks.printPslContract.mockReset().mockReturnValue({ kind: 'document' });
  mocks.getPslBlockDescriptors.mockReset().mockReturnValue({});
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.resolveContractSource
    .mockReset()
    .mockResolvedValue({ stack: {}, validatedContract: { ok: true, value: CONTRACT } });
  mocks.printPsl.mockReset().mockReturnValue(PSL);
});

const DESCRIPTOR = {
  familyId: 'sql',
  targetId: 'postgres',
  version: '1.0.0',
  create: () => ({}),
};

function ormConfig(dir: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({}),
    },
    target: { ...DESCRIPTOR, kind: 'target', id: 'postgres' },
    adapter: { ...DESCRIPTOR, kind: 'adapter', id: 'pg' },
    driver: { ...DESCRIPTOR, kind: 'driver', id: 'pg-driver' },
    contract: {
      source: { format: 'prisma7', inputs: ['./schema.prisma'], load: () => ({}) },
      output: join(dir, 'generated', 'contract.json'),
    },
    ...overrides,
  };
}

function harness(config: Record<string, unknown>) {
  return createTestCli({ commands, groups, config: { orm: config } });
}

function erroredEnvelope(run: { readonly json: readonly StreamEvent[] }): ErroredEnvelope {
  const terminal = run.json.at(-1);
  if (terminal === undefined || terminal.kind !== 'result' || terminal.envelope.ok) {
    throw new Error('the run did not settle as an errored envelope');
  }
  return terminal.envelope;
}

describe('contract convert', () => {
  it('names contract convert, not contract emit, in the next action when the source fails', async () => {
    const dir = await projectDir();
    const failing: MountedTree = {
      'contract convert': createContractConvertCommand({
        createControlClient: () => ({
          printPslContract: mocks.printPslContract,
          getPslBlockDescriptors: mocks.getPslBlockDescriptors,
          close: mocks.close,
        }),
        resolveContractSource,
        printPsl: mocks.printPsl,
      }),
    };
    const config = ormConfig(dir, {
      contract: {
        source: {
          format: 'prisma7',
          inputs: ['./schema.prisma'],
          load: async () => ({
            ok: false,
            failure: {
              summary: 'Prisma 7 schema interpretation failed',
              diagnostics: [
                {
                  code: 'PRISMA7_VIEW_UNSUPPORTED',
                  message: 'View "ActiveUsers" is not supported',
                  sourceId: './schema.prisma',
                  span: {
                    start: { offset: 0, line: 9, character: 1 },
                    end: { offset: 0, line: 9, character: 1 },
                  },
                },
              ],
            },
          }),
        },
        output: join(dir, 'generated', 'contract.json'),
      },
    });

    const run = await createTestCli({ commands: failing, groups, config: { orm: config } }).run(
      ['contract', 'convert', '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).not.toBe(0);
    const envelope = erroredEnvelope(run);
    expect(envelope.error.code).toBe('CONTRACT.SOURCE_LOAD_FAILED');
    expect(envelope.nextActions).toEqual([
      {
        kind: 'user-choice',
        label: 'Edit the schema where each finding points, then run contract convert again.',
      },
    ]);
    expect(JSON.stringify(envelope)).not.toContain('contract emit again');
    expect(existsSync(join(dir, 'generated'))).toBe(false);
  });

  it('writes the printed PSL beside the emitted contract and reports the path', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig(dir)).run(['contract', 'convert', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toEqual({
      ok: true,
      summary: 'Contract converted successfully',
      target: { familyId: 'sql', id: 'postgres' },
      source: { format: 'prisma7', input: 'schema.prisma' },
      psl: { path: 'generated/contract.prisma', overwrote: false },
      timings: { total: expect.any(Number) },
    });
    expect(await readFile(join(dir, 'generated', 'contract.prisma'), 'utf-8')).toBe(PSL);
    expect(await readdir(join(dir, 'generated'))).toEqual(['contract.prisma']);
  });

  it('prints the loaded contract with a header naming the configured schema path', async () => {
    const dir = await projectDir();

    await harness(ormConfig(dir)).run(['contract', 'convert', '--json'], { cwd: dir });

    expect(mocks.printPslContract).toHaveBeenCalledWith(CONTRACT);
    expect(mocks.printPsl).toHaveBeenCalledWith(
      { kind: 'document' },
      {
        header: '// Converted from schema.prisma by `prisma contract convert`.',
        pslBlockDescriptors: {},
      },
    );
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('respects --output', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig(dir)).run(
      ['contract', 'convert', '--output', 'src/prisma/contract.prisma', '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ psl: { path: 'src/prisma/contract.prisma' } });
    expect(await readFile(join(dir, 'src', 'prisma', 'contract.prisma'), 'utf-8')).toBe(PSL);
  });

  it('warns before overwriting an existing file', async () => {
    const dir = await projectDir();
    await writeFile(join(dir, 'contract.prisma'), 'old', 'utf-8');

    const run = await harness(ormConfig(dir)).run(
      ['contract', 'convert', '--output', 'contract.prisma'],
      { cwd: dir, isTty: { stdout: true } },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      psl: { path: 'contract.prisma', overwrote: true },
    });
    expect(run.presented?.presentation.human).toContainEqual({
      kind: 'summary',
      status: 'warn',
      text: [{ text: 'Overwrote existing file ' }, { text: 'contract.prisma', tone: 'identifier' }],
    });
    expect(await readFile(join(dir, 'contract.prisma'), 'utf-8')).toBe(PSL);
  });

  it('refuses a PSL source and writes nothing', async () => {
    const dir = await projectDir();
    const config = ormConfig(dir, {
      contract: {
        source: { format: 'psl', inputs: ['./contract.prisma'], load: () => ({}) },
        output: join(dir, 'generated', 'contract.json'),
      },
    });

    const run = await harness(config).run(['contract', 'convert', '--json'], { cwd: dir });

    expect(run.exitCode).not.toBe(0);
    expect(erroredEnvelope(run).error).toMatchObject({
      code: 'CONTRACT.CONVERT_REQUIRES_PRISMA7_SOURCE',
      why: expect.stringContaining('format "psl"'),
    });
    expect(existsSync(join(dir, 'generated'))).toBe(false);
    expect(mocks.resolveContractSource).not.toHaveBeenCalled();
  });

  it('reports CONTRACT.CONVERT_UNSUPPORTED when the target cannot print, and writes nothing', async () => {
    const dir = await projectDir();
    mocks.printPslContract.mockReturnValue(undefined);

    const run = await harness(ormConfig(dir)).run(['contract', 'convert', '--json'], { cwd: dir });

    expect(run.exitCode).not.toBe(0);
    expect(erroredEnvelope(run).error).toMatchObject({
      code: 'CONTRACT.CONVERT_UNSUPPORTED',
      meta: { targetId: 'postgres' },
    });
    expect(existsSync(join(dir, 'generated'))).toBe(false);
  });

  it('surfaces the source diagnostics the loader raised and writes nothing', async () => {
    const dir = await projectDir();
    const { CliStructuredError } = await import('@internal/errors/control');
    mocks.resolveContractSource.mockRejectedValue(
      new CliStructuredError('CONTRACT.SOURCE_LOAD_FAILED', 'Failed to resolve contract source', {
        why: 'Prisma 7 schema interpretation failed',
        diagnostics: [
          {
            code: 'CONTRACT.SOURCE_DIAGNOSTIC',
            severity: 'error',
            summary: 'PRISMA7_VIEW_UNSUPPORTED: View "ActiveUsers" is not supported',
            nextActions: [],
            where: { path: './schema.prisma', line: 9 },
          },
        ],
      }),
    );

    const run = await harness(ormConfig(dir)).run(['contract', 'convert', '--json'], { cwd: dir });

    expect(run.exitCode).not.toBe(0);
    expect(erroredEnvelope(run)).toMatchObject({
      error: { code: 'CONTRACT.SOURCE_LOAD_FAILED' },
      diagnostics: [expect.objectContaining({ where: { path: './schema.prisma', line: 9 } })],
    });
    expect(existsSync(join(dir, 'generated'))).toBe(false);
  });
});
