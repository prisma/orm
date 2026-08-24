import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { writeRef } from '@internal/migration-tools/refs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupRefProjects,
  emptyProject,
  HASH_A,
  HASH_ABSENT,
  HASH_B,
  harness,
  ormConfig,
  refPointerPath,
  refsDirIn,
  seedProjectMissingSnapshot,
  seedRefProject,
} from './ref-fixtures';

afterEach(cleanupRefProjects);

describe('ref set', () => {
  it('settles as a completed envelope and writes only the pointer', async () => {
    const { dir } = await seedRefProject();

    const run = await harness().run(['migration', 'ref', 'set', 'staging', HASH_A, '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: true,
        exitCode: 0,
        result: { ok: true, ref: 'staging', hash: HASH_A, invariants: [] },
      },
    });
    expect(JSON.parse(await readFile(refPointerPath(dir, 'staging'), 'utf-8'))).toEqual({
      hash: HASH_A,
      invariants: [],
    });
  });

  it('renders one summary block naming the ref and the contract it points at', async () => {
    const { dir } = await seedRefProject();

    const run = await harness().run(['migration', 'ref', 'set', 'staging', HASH_A], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human).toEqual([
      {
        kind: 'summary',
        status: 'ok',
        text: [
          { text: 'Set ref "' },
          { text: 'staging', tone: 'ref' },
          { text: '" → ' },
          { text: HASH_A, tone: 'identifier' },
        ],
      },
    ]);
  });

  it('leaves stdout empty in human mode, having no machine-consumable lines', async () => {
    const { dir } = await seedRefProject();

    const run = await harness().run(['migration', 'ref', 'set', 'staging', HASH_A], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.stdout).toEqual([]);
    expect(run.stdout).toBe('');
  });

  it('resolves another ref name to its hash', async () => {
    const { dir } = await seedRefProject();
    await writeRef(refsDirIn(dir), 'production', { hash: HASH_B, invariants: [] });

    const run = await harness().run(
      ['migration', 'ref', 'set', 'staging', 'production', '--json'],
      {
        cwd: dir,
      },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toEqual({
      ok: true,
      ref: 'staging',
      hash: HASH_B,
      invariants: [],
    });
  });

  it('resolves a migration directory name to its destination contract', async () => {
    const { dir, initialDirName } = await seedRefProject();

    const run = await harness().run(
      ['migration', 'ref', 'set', 'staging', initialDirName, '--json'],
      {
        cwd: dir,
      },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ hash: HASH_A });
  });

  it('resolves <dir>^ to the source contract of that migration', async () => {
    const { dir, secondDirName } = await seedRefProject();

    const run = await harness().run(
      ['migration', 'ref', 'set', 'staging', `${secondDirName}^`, '--json'],
      {
        cwd: dir,
      },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ hash: HASH_A });
  });

  it('overwrites an existing pointer', async () => {
    const { dir } = await seedRefProject();
    const cli = harness();

    await cli.run(['migration', 'ref', 'set', 'staging', HASH_A, '--json'], { cwd: dir });
    const run = await cli.run(['migration', 'ref', 'set', 'staging', HASH_B, '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(await readFile(refPointerPath(dir, 'staging'), 'utf-8'))).toEqual({
      hash: HASH_B,
      invariants: [],
    });
  });

  it('refuses a hash the migration graph does not carry, writing no pointer', async () => {
    const { dir } = await seedRefProject();

    const run = await harness().run(['migration', 'ref', 'set', 'staging', HASH_ABSENT, '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.HASH_NOT_IN_GRAPH' } },
    });
    expect(existsSync(refPointerPath(dir, 'staging'))).toBe(false);
  });

  it('names the empty graph and offers planning when the project has no migrations', async () => {
    const dir = await emptyProject();

    const run = await harness().run(['migration', 'ref', 'set', 'staging', HASH_A, '--json'], {
      cwd: dir,
    });
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

    expect(run.exitCode).toBe(2);
    expect(envelope).toMatchObject({
      ok: false,
      error: { code: 'MIGRATION.HASH_NOT_IN_GRAPH', why: expect.stringContaining('empty') },
      nextActions: [{ kind: 'run-command', command: '{bin} migration plan' }],
    });
  });

  it('refuses the empty-database sentinel hash', async () => {
    const { dir } = await seedRefProject();

    const run = await harness().run(
      ['migration', 'ref', 'set', 'staging', EMPTY_CONTRACT_HASH, '--json'],
      {
        cwd: dir,
      },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.REF_SET_EMPTY_SENTINEL' } },
    });
  });

  it('refuses a contract whose bundle never got its snapshot written', async () => {
    const dir = await seedProjectMissingSnapshot();

    const run = await harness().run(['migration', 'ref', 'set', 'staging', HASH_A, '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CLI.FILE_NOT_FOUND' } },
    });
    expect(existsSync(refPointerPath(dir, 'staging'))).toBe(false);
  });

  it('refuses an invalid ref name', async () => {
    const { dir } = await seedRefProject();

    const run = await harness().run(['migration', 'ref', 'set', '../evil', HASH_A, '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.INVALID_REF_NAME' } },
    });
  });

  it('gives the errored envelope typed next actions and no fix prose', async () => {
    const { dir } = await seedRefProject();

    const run = await harness().run(['migration', 'ref', 'set', 'staging', HASH_ABSENT, '--json'], {
      cwd: dir,
    });
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

    expect(envelope?.ok).toBe(false);
    expect(envelope?.nextActions.length).toBeGreaterThan(0);
    expect(envelope).not.toHaveProperty('fix');
  });

  it('resolves the refs directory against the run cwd, not the process cwd', async () => {
    const { dir } = await seedRefProject('db');

    const run = await harness({ ...ormConfig(), migrations: { dir: 'db' } }).run(
      ['migration', 'ref', 'set', 'staging', HASH_A, '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(0);
    expect(existsSync(refPointerPath(dir, 'staging', 'db'))).toBe(true);
  });

  it('fails before the handler when the orm section is structurally invalid', async () => {
    const { dir } = await seedRefProject();

    const run = await harness({ migrations: { dir: 42 } }).run(
      ['migration', 'ref', 'set', 'staging', HASH_A, '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CLI.CONFIG_SECTION_INVALID' } },
    });
  });
});
