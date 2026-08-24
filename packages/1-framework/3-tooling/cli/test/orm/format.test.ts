import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { afterEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createTestProjectDir } from '../utils/test-project-dir';

const MESSY_PSL = 'model    User{id Int @id\nname String}\n';
const FORMATTED_PSL = `model User {
  id   Int    @id
  name String
}
`;

const dirs: string[] = [];

async function projectDir(): Promise<string> {
  const dir = createTestProjectDir('orm-format');
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function ormConfig(source: Record<string, unknown>): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({}),
    },
    target: {
      kind: 'target',
      id: 'postgres',
      familyId: 'sql',
      targetId: 'postgres',
      version: '1.0.0',
      create: () => ({}),
    },
    adapter: {
      kind: 'adapter',
      id: 'pg',
      familyId: 'sql',
      targetId: 'postgres',
      version: '1.0.0',
      create: () => ({}),
    },
    contract: { source, output: 'output/contract.json' },
    formatter: { newline: 'LF' },
  };
}

function pslConfig(inputPath: string): Record<string, unknown> {
  return ormConfig({ format: 'psl', inputs: [inputPath], load: async () => ({}) });
}

function harness(config: Record<string, unknown>) {
  return createTestCli({
    commands: BIN_COMMANDS,
    groups: BIN_GROUPS,
    config: { orm: config },
  });
}

async function projectWithMessySource(): Promise<string> {
  const dir = await projectDir();
  await writeFile(join(dir, 'contract.prisma'), MESSY_PSL, 'utf-8');
  return dir;
}

describe('format', () => {
  it('settles as a completed envelope and rewrites the source in place', async () => {
    const dir = await projectWithMessySource();

    const run = await harness(pslConfig(join(dir, 'contract.prisma'))).run(
      ['contract', 'format', '--json'],
      {
        cwd: dir,
      },
    );

    expect(run.exitCode).toBe(0);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: true, exitCode: 0, result: { formatted: true } },
    });
    expect(await readFile(join(dir, 'contract.prisma'), 'utf-8')).toBe(FORMATTED_PSL);
  });

  it('renders one summary block naming the file it formatted', async () => {
    const dir = await projectWithMessySource();

    const run = await harness(pslConfig(join(dir, 'contract.prisma'))).run(['contract', 'format'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human).toEqual([
      {
        kind: 'summary',
        status: 'ok',
        text: [{ text: 'Formatted ' }, { text: 'contract.prisma', tone: 'identifier' }],
      },
    ]);
  });

  it('leaves stdout empty in human mode, having no machine-consumable lines', async () => {
    const dir = await projectWithMessySource();

    const run = await harness(pslConfig(join(dir, 'contract.prisma'))).run(['contract', 'format'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.stdout).toEqual([]);
    expect(run.stdout).toBe('');
  });

  it('renders the success line even under --quiet', async () => {
    const dir = await projectWithMessySource();

    const run = await harness(pslConfig(join(dir, 'contract.prisma'))).run(
      ['contract', 'format', '--quiet'],
      {
        cwd: dir,
        isTty: { stdout: true, stderr: true },
      },
    );

    expect(run.exitCode).toBe(0);
    expect(stripAnsi(run.stderr)).toContain('Formatted contract.prisma');
  });

  it('reports nothing to format when the source is not PSL, leaving the file alone', async () => {
    const dir = await projectWithMessySource();
    const config = ormConfig({
      format: 'typescript',
      inputs: [join(dir, 'contract.prisma')],
      load: async () => ({}),
    });

    const run = await harness(config).run(['contract', 'format'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.data).toEqual({ formatted: false });
    expect(run.presented?.presentation.human).toEqual([
      {
        kind: 'summary',
        status: 'info',
        text: 'Nothing to format (contract source is not PSL).',
      },
    ]);
    expect(await readFile(join(dir, 'contract.prisma'), 'utf-8')).toBe(MESSY_PSL);
  });

  it('refuses unparseable PSL with the dotted code and writes nothing', async () => {
    const dir = await projectDir();
    const broken = 'model {{{ broken\n';
    await writeFile(join(dir, 'contract.prisma'), broken, 'utf-8');

    const run = await harness(pslConfig(join(dir, 'contract.prisma'))).run(
      ['contract', 'format', '--json'],
      {
        cwd: dir,
      },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'PSL.PARSE_FAILED' } },
    });
    expect(await readFile(join(dir, 'contract.prisma'), 'utf-8')).toBe(broken);
  });

  it('gives the errored envelope typed next actions and no fix prose', async () => {
    const dir = await projectDir();
    await writeFile(join(dir, 'contract.prisma'), 'model {{{ broken\n', 'utf-8');

    const run = await harness(pslConfig(join(dir, 'contract.prisma'))).run(
      ['contract', 'format', '--json'],
      {
        cwd: dir,
      },
    );
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

    expect(envelope?.ok).toBe(false);
    expect(envelope?.nextActions.length).toBeGreaterThan(0);
    expect(envelope).not.toHaveProperty('fix');
  });

  it('reports the unreadable source rather than throwing', async () => {
    const dir = await projectDir();

    const run = await harness(pslConfig(join(dir, 'missing.prisma'))).run(
      ['contract', 'format', '--json'],
      {
        cwd: dir,
      },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CONTRACT.SOURCE_LOAD_FAILED' } },
    });
  });

  it('resolves a relative source against the run cwd, not the process cwd', async () => {
    const first = await projectDir();
    const second = await projectDir();
    await mkdir(join(second, 'schema'), { recursive: true });
    await writeFile(join(second, 'schema', 'contract.prisma'), MESSY_PSL, 'utf-8');
    await writeFile(join(first, 'schema.prisma'), MESSY_PSL, 'utf-8');

    const run = await harness(pslConfig('schema/contract.prisma')).run(['contract', 'format'], {
      cwd: second,
      isTty: { stdout: true },
    });

    expect(run.exitCode).toBe(0);
    expect(await readFile(join(second, 'schema', 'contract.prisma'), 'utf-8')).toBe(FORMATTED_PSL);
    expect(await readFile(join(first, 'schema.prisma'), 'utf-8')).toBe(MESSY_PSL);
  });

  it('fails before the handler when the orm section is structurally invalid', async () => {
    const dir = await projectDir();

    const run = await harness({ formatter: { indent: 'wide' } }).run(
      ['contract', 'format', '--json'],
      {
        cwd: dir,
      },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CLI.CONFIG_SECTION_INVALID' } },
    });
  });
});
