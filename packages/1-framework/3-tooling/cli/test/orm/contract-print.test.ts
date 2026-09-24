import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { ok } from '@internal/utils/result';
import { structuredError } from '@internal/utils/structured-error';
import type { ErroredEnvelope, MountedTree, StreamEvent } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BIN_GROUPS } from '../../src/orm/cli';
import { createContractPrintCommand } from '../../src/orm/contract/print';
import { createTestProjectDir } from '../utils/test-project-dir';

const PSL = 'model User {\n  id Int @id\n}\n';

/**
 * The command is mounted from the factory with a control-client double and a
 * printer double injected, so no module mocking is involved and the doubles
 * are scoped to this file.
 */
const mocks = {
  printPslContract: vi.fn(),
  getPslBlockDescriptors: vi.fn(),
  close: vi.fn(),
  printPsl: vi.fn(),
  load: vi.fn(),
};

const commands: MountedTree = {
  'contract print': createContractPrintCommand({
    createControlClient: () => ({
      printPslContract: mocks.printPslContract,
      getPslBlockDescriptors: mocks.getPslBlockDescriptors,
      close: mocks.close,
    }),
    printPsl: mocks.printPsl,
  }),
};
const groups = BIN_GROUPS;

const dirs: string[] = [];

async function projectDir(): Promise<string> {
  const dir = createTestProjectDir('orm-print');
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  mocks.printPslContract.mockReset().mockReturnValue({ kind: 'psl-document' });
  mocks.getPslBlockDescriptors.mockReset().mockReturnValue({});
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.printPsl.mockReset().mockReturnValue(PSL);
  mocks.load.mockReset().mockResolvedValue(ok({ roots: {}, domain: {} }));
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
      source: { format: 'psl', inputs: ['./prisma/schema.prisma'], load: mocks.load },
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

describe('contract print', () => {
  it('settles as a completed envelope carrying the written path and the schema it read', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig(dir)).run(['contract', 'print', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toEqual({
      ok: true,
      summary: 'Contract printed successfully',
      target: { familyId: 'sql', id: 'postgres' },
      psl: { path: 'generated/contract.prisma' },
      source: ['prisma/schema.prisma'],
      timings: { total: expect.any(Number) },
    });
  });

  it('opens the written file with a header naming the source it printed', async () => {
    const dir = await projectDir();

    await harness(ormConfig(dir)).run(['contract', 'print', '--json'], { cwd: dir });

    expect(mocks.printPsl).toHaveBeenCalledWith(
      { kind: 'psl-document' },
      expect.objectContaining({
        headerComment:
          '// use prisma-8\n// Printed from prisma/schema.prisma by `prisma contract print`.',
      }),
    );
    expect(await readFile(join(dir, 'generated', 'contract.prisma'), 'utf-8')).toBe(PSL);
  });

  it('publishes through a staged rename, leaving no temporary file behind', async () => {
    const dir = await projectDir();

    await harness(ormConfig(dir)).run(['contract', 'print', '--json'], { cwd: dir });

    expect(await readdir(join(dir, 'generated'))).toEqual(['contract.prisma']);
  });

  it('writes nothing when the run is cancelled while the client is closing', async () => {
    const dir = await projectDir();
    const controller = new AbortController();
    mocks.close.mockImplementation(async () => {
      controller.abort();
    });

    const run = await harness(ormConfig(dir)).run(['contract', 'print', '--json'], {
      cwd: dir,
      abort: controller.signal,
    });

    expect(run.exitCode).not.toBe(0);
    expect(await readdir(dir)).not.toContain('generated');
  });

  it('resolves a relative --output against the invocation directory', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig(dir)).run(
      ['contract', 'print', '--output', 'schema/live.prisma', '--json'],
      { cwd: dir },
    );

    expect(await readFile(join(dir, 'schema', 'live.prisma'), 'utf-8')).toBe(PSL);
    expect(run.presented?.data).toMatchObject({ psl: { path: 'schema/live.prisma' } });
  });

  it('overwrites an existing contract with a warning and no prompt', async () => {
    const dir = await projectDir();
    const run1 = await harness(ormConfig(dir)).run(
      ['contract', 'print', '--output', 'contract.prisma', '--json'],
      { cwd: dir },
    );
    await writeFile(join(dir, 'contract.prisma'), 'model Stale {}\n', 'utf-8');

    const run2 = await harness(ormConfig(dir)).run(
      ['contract', 'print', '--output', 'contract.prisma', '--json'],
      { cwd: dir },
    );

    expect(run1.events).not.toContainEqual(expect.objectContaining({ severity: 'warn' }));
    expect(run2.exitCode).toBe(0);
    expect(run2.events).toContainEqual({
      kind: 'message',
      severity: 'warn',
      text: 'Overwriting existing file: contract.prisma',
    });
    expect(await readFile(join(dir, 'contract.prisma'), 'utf-8')).toBe(PSL);
  });

  it('ships the written path and the next step as blocks', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig(dir)).run(['contract', 'print'], {
      cwd: dir,
      isTty: { stdout: true, stderr: true },
    });

    expect(run.presented?.presentation.human).toEqual([
      {
        kind: 'summary',
        status: 'ok',
        text: [
          { text: 'Contract written to ' },
          { text: 'generated/contract.prisma', tone: 'identifier' },
        ],
      },
    ]);
    expect(run.presented?.presentation.next).toEqual([
      {
        kind: 'user-choice',
        label: 'Point contract in prisma.config.ts at generated/contract.prisma',
      },
      { kind: 'run-command', label: 'Emit the printed contract', command: '{bin} contract emit' },
    ]);
    expect(run.presented?.presentation.stdout).toEqual([]);
    expect(stripAnsi(run.stderr)).toContain('Contract written to generated/contract.prisma');
    expect(run.stdout).toBe('');
  });

  it('names the default control policy the config must set, because a PSL file cannot carry it', async () => {
    const dir = await projectDir();
    mocks.load.mockResolvedValue(ok({ roots: {}, domain: {}, defaultControlPolicy: 'external' }));

    const run = await harness(ormConfig(dir)).run(['contract', 'print', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ defaultControlPolicy: 'external' });
    expect(run.presented?.presentation.next).toEqual([
      {
        kind: 'user-choice',
        label:
          "Point contract in prisma.config.ts at generated/contract.prisma, with defaultControlPolicy 'external' on its source",
      },
      { kind: 'run-command', label: 'Emit the printed contract', command: '{bin} contract emit' },
    ]);
  });

  it('refuses to write over the schema it reads and leaves that file untouched', async () => {
    const dir = await projectDir();
    const schema = 'model User {\n  id Int @id\n}\n';
    await mkdir(join(dir, 'prisma'), { recursive: true });
    await writeFile(join(dir, 'prisma', 'schema.prisma'), schema, 'utf-8');

    const run = await harness(ormConfig(dir)).run(
      ['contract', 'print', '--output', 'prisma/schema.prisma', '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(2);
    expect(erroredEnvelope(run).error).toMatchObject({
      code: 'CONTRACT.PRINT_OUTPUT_IS_SOURCE',
      meta: { output: 'prisma/schema.prisma', source: 'prisma/schema.prisma' },
    });
    expect(await readFile(join(dir, 'prisma', 'schema.prisma'), 'utf-8')).toBe(schema);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('refuses an output path inside a directory the contract source reads', async () => {
    const dir = await projectDir();
    const config = ormConfig(dir, {
      contract: {
        source: { format: 'psl', inputs: ['./prisma'], load: mocks.load },
        output: join(dir, 'generated', 'contract.json'),
      },
    });

    const run = await harness(config).run(
      ['contract', 'print', '--output', 'prisma/nested/contract.prisma', '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(2);
    expect(erroredEnvelope(run).error).toMatchObject({ code: 'CONTRACT.PRINT_OUTPUT_IS_SOURCE' });
    expect(await readdir(dir)).not.toContain('prisma');
  });

  it('prints a PSL source the same way as any other source', async () => {
    const dir = await projectDir();
    const config = ormConfig(dir, {
      contract: {
        source: { format: 'psl', inputs: ['./contract.prisma'], load: mocks.load },
        output: join(dir, 'generated', 'contract.json'),
      },
    });

    const run = await harness(config).run(['contract', 'print', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(0);
    expect(mocks.load).toHaveBeenCalled();
    expect(mocks.printPsl).toHaveBeenCalledWith(
      { kind: 'psl-document' },
      expect.objectContaining({
        headerComment:
          '// use prisma-8\n// Printed from contract.prisma by `prisma contract print`.',
      }),
    );
    expect(await readFile(join(dir, 'generated', 'contract.prisma'), 'utf-8')).toBe(PSL);
  });

  it('reports what the source reported when it cannot load the schema', async () => {
    const dir = await projectDir();
    mocks.load.mockResolvedValue({
      ok: false,
      failure: {
        summary: 'Prisma 8 does not support views',
        diagnostics: [{ code: 'PSL.FIXTURE_VIEW_UNSUPPORTED', message: 'a view is not a model' }],
      },
    });

    const run = await harness(ormConfig(dir)).run(['contract', 'print', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(2);
    expect(erroredEnvelope(run).error).toMatchObject({ code: 'CONTRACT.SOURCE_LOAD_FAILED' });
    expect(await readdir(dir)).not.toContain('generated');
  });

  it('errors when the family cannot print the contract as PSL', async () => {
    const dir = await projectDir();
    mocks.printPslContract.mockReturnValue(undefined);

    const run = await harness(ormConfig(dir)).run(['contract', 'print', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(2);
    expect(erroredEnvelope(run).error).toMatchObject({ code: 'CONTRACT.PRINT_UNSUPPORTED' });
    expect(mocks.close).toHaveBeenCalled();
  });

  it('writes no file at the output path when the target refuses part of the contract', async () => {
    const dir = await projectDir();
    mocks.printPslContract.mockImplementation(() => {
      throw structuredError(
        'CONTRACT.PRINT_UNSUPPORTED',
        'contract print: field "public".Shop.location has a union type, which cannot be written in Prisma 8 PSL.',
        {
          why: 'A PSL field names one scalar, enum, or value-object type; a union of types has no PSL form.',
          fix: 'Give the field a single type.',
          meta: { coordinate: '"public".Shop.location', kind: 'union' },
        },
      );
    });

    const run = await harness(ormConfig(dir)).run(
      ['contract', 'print', '--output', 'contract.prisma', '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(2);
    expect(erroredEnvelope(run).error).toMatchObject({
      code: 'CONTRACT.PRINT_UNSUPPORTED',
      summary: expect.stringContaining('"public".Shop.location'),
    });
    expect(await readdir(dir)).not.toContain('contract.prisma');
  });

  it('reports the code, summary and next actions of a refusal the target raised', async () => {
    const dir = await projectDir();
    mocks.printPslContract.mockImplementation(() => {
      throw structuredError(
        'CONTRACT.PRINT_UNSUPPORTED',
        'contract print: field "public".Shop.location has a union type, which cannot be written in Prisma 8 PSL.',
        {
          why: 'A PSL field names one scalar, enum, or value-object type; a union of types has no PSL form.',
          fix: 'Give the field a single type.',
          meta: { coordinate: '"public".Shop.location', kind: 'union' },
        },
      );
    });

    const run = await harness(ormConfig(dir)).run(['contract', 'print', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(2);
    expect(erroredEnvelope(run).error).toMatchObject({
      code: 'CONTRACT.PRINT_UNSUPPORTED',
      summary: expect.stringContaining('"public".Shop.location'),
      why: 'A PSL field names one scalar, enum, or value-object type; a union of types has no PSL form.',
      nextActions: [{ kind: 'user-choice', label: 'Give the field a single type.' }],
      meta: { coordinate: '"public".Shop.location', kind: 'union' },
    });
    expect(await readdir(dir)).not.toContain('generated');
  });
});
