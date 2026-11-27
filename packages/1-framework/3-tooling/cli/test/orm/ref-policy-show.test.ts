import stripAnsi from 'strip-ansi';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupRefProjects, harness } from './ref-fixtures';
import {
  PLAIN_REF,
  projectWithRef,
  readText,
  runPolicy,
  writeRefText,
} from './ref-policy-fixtures';

afterEach(cleanupRefProjects);

describe('ref policy show', () => {
  it('returns every setting, null where the ref declares nothing, and no changes', async () => {
    const { dir } = await projectWithRef('production', {
      ...PLAIN_REF,
      policies: { change: ['migrate'], dataProtection: { dataLoss: 'data-loss-forbidden' } },
    });

    const run = await runPolicy(dir, ['show', 'production', '--json']);

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toEqual({
      ok: true,
      ref: 'production',
      policies: {
        change: ['migrate'],
        dataProtection: { dataLoss: 'data-loss-forbidden', accessWidening: null },
      },
      changes: [],
    });
  });

  it('prints each setting the ref declares, and that a database may differ', async () => {
    const { dir } = await projectWithRef('production', {
      ...PLAIN_REF,
      policies: { change: ['migrate'], dataProtection: { dataLoss: 'data-loss-forbidden' } },
    });

    const run = await harness().run(['migration', 'ref', 'policy', 'show', 'production'], {
      cwd: dir,
      isTty: { stdout: true, stderr: true },
    });
    const rendered = stripAnsi(run.stderr)
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    expect(rendered).toEqual([
      'ℹ Policies ref production declares (migrations/app/refs/production.json)',
      'change:                         migrate',
      'dataProtection.dataLoss:        data-loss-forbidden',
      'dataProtection.accessWidening:  not declared',
      'ℹ These are what the ref declares, not what a database has. Compare with a database: prisma-test migration status --to production --db <url>',
    ]);
  });

  it('prints one line per declared setting on stdout', async () => {
    const { dir } = await projectWithRef('production', {
      ...PLAIN_REF,
      policies: { change: ['migrate', 'reconcile'] },
    });

    const run = await runPolicy(dir, ['show', 'production']);

    expect(run.stdout).toBe('change\tmigrate,reconcile\n');
  });

  it('prints no data lines for a ref that declares nothing', async () => {
    const { dir } = await projectWithRef('production', PLAIN_REF);

    const run = await runPolicy(dir, ['show', 'production']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe('');
  });

  it('reads only the named ref, with no migrations directory and another ref invalid', async () => {
    const { dir, path } = await projectWithRef('production', PLAIN_REF);
    await writeRefText(dir, 'broken', '{ not json');
    const before = await readText(path);

    const run = await runPolicy(dir, ['show', 'production']);

    expect(run.exitCode).toBe(0);
    expect(await readText(path)).toBe(before);
  });

  it.each([
    ['a ref that does not exist', 'staging', 'MIGRATION.UNKNOWN_REF'],
    ['the head ref', 'head', 'CLI.INVALID_ARGUMENTS'],
  ])('fails for %s', async (_name, ref, code) => {
    const { dir } = await projectWithRef('head', PLAIN_REF);

    const run = await runPolicy(dir, ['show', ref, '--json']);

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({ envelope: { ok: false, error: { code } } });
  });
});
