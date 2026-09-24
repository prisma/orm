import { readdir, readFile, writeFile } from 'node:fs/promises';
import { ok } from '@internal/utils/result';
import { structuredError } from '@internal/utils/structured-error';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import {
  erroredEnvelope,
  harness,
  mocks,
  ormConfig,
  PSL,
  projectDir,
  useContractPrintDoubles,
  VALIDATED_CONTRACT,
} from './contract-print-support';

useContractPrintDoubles();

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

  it('describes the written file as printed from the source it read', async () => {
    const dir = await projectDir();

    await harness(ormConfig(dir)).run(['contract', 'print', '--json'], { cwd: dir });

    expect(mocks.printPsl).toHaveBeenCalledWith(
      { kind: 'psl-document' },
      expect.objectContaining({
        description: 'Printed from prisma/schema.prisma by `prisma contract print`.',
      }),
    );
    expect(await readFile(join(dir, 'generated', 'contract.prisma'), 'utf-8')).toBe(PSL);
  });

  it('loads the source, creates the family instance and renders the text with one control stack', async () => {
    const dir = await projectDir();

    await harness(ormConfig(dir)).run(['contract', 'print', '--json'], { cwd: dir });

    const [stack] = mocks.createFamilyInstance.mock.calls[0] ?? [];
    const [sourceContext] = mocks.load.mock.calls[0] ?? [];
    const [, printOptions] = mocks.printPsl.mock.calls[0] ?? [];
    expect(sourceContext.codecLookup).toBe(stack.codecLookup);
    expect(sourceContext.authoringContributions).toBe(stack.authoringContributions);
    expect(printOptions.codecLookup).toBe(stack.codecLookup);
    expect(printOptions.pslBlockDescriptors).toBe(stack.authoringContributions.pslBlockDescriptors);
    expect(mocks.printPslContract).toHaveBeenCalledWith(VALIDATED_CONTRACT);
  });

  it('publishes through a staged rename, leaving no temporary file behind', async () => {
    const dir = await projectDir();

    await harness(ormConfig(dir)).run(['contract', 'print', '--json'], { cwd: dir });

    expect(await readdir(join(dir, 'generated'))).toEqual(['contract.prisma']);
  });

  it('writes nothing when the run is cancelled while the source loads', async () => {
    const dir = await projectDir();
    const controller = new AbortController();
    mocks.load.mockImplementation(async () => {
      controller.abort();
      return ok({ roots: {}, domain: {} });
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

  it('warns that the config must set the default control policy, because a PSL file cannot carry it', async () => {
    const dir = await projectDir();
    mocks.printPslContract.mockReturnValue({
      document: { kind: 'psl-document' },
      sourceSettings: { defaultControlPolicy: 'external' },
    });

    const run = await harness(ormConfig(dir)).run(['contract', 'print', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(0);
    expect(run.events).toContainEqual({
      kind: 'message',
      severity: 'warn',
      text: "The contract's default control policy is 'external', and a PSL file cannot carry it. Set defaultControlPolicy: 'external' on the PSL source in prisma.config.ts. Without it, the emitted contract has no default control policy, and everything that sets no control policy of its own is treated as managed.",
    });
    expect(run.presented?.data).toMatchObject({ defaultControlPolicy: 'external' });
    expect(run.presented?.presentation.next).toEqual([
      {
        kind: 'user-choice',
        label:
          "Point contract in prisma.config.ts at generated/contract.prisma, through a PSL source that sets defaultControlPolicy: 'external'",
      },
      { kind: 'run-command', label: 'Emit the printed contract', command: '{bin} contract emit' },
    ]);
  });

  it('prints no warning when the contract has no default control policy', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig(dir)).run(['contract', 'print', '--json'], { cwd: dir });

    expect(run.events).not.toContainEqual(expect.objectContaining({ severity: 'warn' }));
  });

  it('says where contract emit writes after the switch when the printed file names other emitted files', async () => {
    const dir = await projectDir();
    const config = ormConfig(dir, {
      contract: {
        source: { format: 'psl', inputs: ['./prisma/schema.prisma'], load: mocks.load },
        output: join(dir, 'prisma', 'schema.json'),
      },
    });

    const run = await harness(config).run(['contract', 'print', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.presentation.next).toEqual([
      {
        kind: 'user-choice',
        label: 'Point contract in prisma.config.ts at prisma/contract.prisma',
      },
      {
        kind: 'user-choice',
        label:
          "With contract: './prisma/contract.prisma' and no output in prisma.config.ts, contract emit writes prisma/contract.json and prisma/contract.d.ts, not prisma/schema.json and prisma/schema.d.ts",
      },
      { kind: 'run-command', label: 'Emit the printed contract', command: '{bin} contract emit' },
    ]);
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
        description: 'Printed from contract.prisma by `prisma contract print`.',
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
    mocks.createFamilyInstance.mockReturnValue({ deserializeContract: mocks.deserializeContract });

    const run = await harness(ormConfig(dir)).run(['contract', 'print', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(2);
    expect(erroredEnvelope(run).error).toMatchObject({ code: 'CONTRACT.PRINT_UNSUPPORTED' });
    expect(await readdir(dir)).not.toContain('generated');
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
