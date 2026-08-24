import { writeRef } from '@internal/migration-tools/refs';
import stripAnsi from 'strip-ansi';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupRefProjects,
  HASH_A,
  HASH_B,
  harness,
  refsDirIn,
  seedRefProject,
} from './ref-fixtures';

afterEach(cleanupRefProjects);

describe('ref list', () => {
  it('settles as a completed envelope carrying every ref', async () => {
    const { dir } = await seedRefProject();
    await writeRef(refsDirIn(dir), 'staging', { hash: HASH_A, invariants: [] });

    const run = await harness().run(['migration', 'ref', 'list', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(0);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: true,
        exitCode: 0,
        result: { ok: true, refs: { staging: { hash: HASH_A, invariants: [] } } },
      },
    });
  });

  it('draws the refs as a table the engine sizes', async () => {
    const { dir } = await seedRefProject();
    await writeRef(refsDirIn(dir), 'staging', { hash: HASH_A, invariants: [] });

    const run = await harness().run(['migration', 'ref', 'list'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human).toEqual([
      {
        kind: 'table',
        columns: ['Ref', 'Contract'],
        rows: [[[{ text: 'staging', tone: 'ref' }], [{ text: HASH_A, tone: 'identifier' }]]],
      },
    ]);
  });

  it('renders the table with its heading and row on stderr', async () => {
    const { dir } = await seedRefProject();
    await writeRef(refsDirIn(dir), 'staging', { hash: HASH_A, invariants: [] });

    const run = await harness().run(['migration', 'ref', 'list'], {
      cwd: dir,
      isTty: { stdout: true, stderr: true },
    });
    const rendered = stripAnsi(run.stderr)
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    expect(rendered).toEqual(['Ref      Contract', `staging  ${HASH_A}`]);
    expect(run.stdout).toBe('');
  });

  it('reports every pointer file it finds', async () => {
    const { dir } = await seedRefProject();
    await writeRef(refsDirIn(dir), 'staging', { hash: HASH_A, invariants: [] });
    await writeRef(refsDirIn(dir), 'production', { hash: HASH_B, invariants: [] });

    const run = await harness().run(['migration', 'ref', 'list', '--json'], { cwd: dir });
    const document = run.presented?.data as { refs: Record<string, { hash: string }> };

    expect(Object.keys(document.refs).sort()).toEqual(['production', 'staging']);
    expect(document.refs['production']?.hash).toBe(HASH_B);
  });

  it('adds the invariants column only when a ref carries invariants', async () => {
    const { dir } = await seedRefProject();
    await writeRef(refsDirIn(dir), 'staging', { hash: HASH_A, invariants: ['users_backfilled'] });

    const run = await harness().run(['migration', 'ref', 'list'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human).toEqual([
      {
        kind: 'table',
        columns: ['Ref', 'Contract', 'Invariants'],
        rows: [
          [
            [{ text: 'staging', tone: 'ref' }],
            [{ text: HASH_A, tone: 'identifier' }],
            'users_backfilled',
          ],
        ],
      },
    ]);
  });

  it('says so when the project has no refs', async () => {
    const { dir } = await seedRefProject();

    const run = await harness().run(['migration', 'ref', 'list'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.data).toEqual({ ok: true, refs: {} });
    expect(run.presented?.presentation.human).toEqual([
      { kind: 'summary', status: 'info', text: 'No refs defined' },
    ]);
  });

  it('leaves stdout empty in human mode', async () => {
    const { dir } = await seedRefProject();
    await writeRef(refsDirIn(dir), 'staging', { hash: HASH_A, invariants: [] });

    const run = await harness().run(['migration', 'ref', 'list'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.stdout).toEqual([]);
    expect(run.stdout).toBe('');
  });
});
