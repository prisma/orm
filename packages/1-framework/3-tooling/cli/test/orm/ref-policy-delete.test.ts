import { existsSync } from 'node:fs';
import stripAnsi from 'strip-ansi';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupRefProjects, HASH_A, harness, refPointerPath } from './ref-fixtures';
import {
  PLAIN_REF,
  projectWithRef,
  readText,
  refFileText,
  runPolicy,
  writeRefText,
} from './ref-policy-fixtures';

afterEach(cleanupRefProjects);

const FULL = {
  ...PLAIN_REF,
  policies: {
    change: ['migrate'],
    dataProtection: {
      dataLoss: 'data-loss-forbidden',
      accessWidening: 'access-widening-permitted',
    },
  },
} as const;

describe('ref policy delete', () => {
  it('removes a setting named as the output names it, and keeps the rest in the ref format', async () => {
    const { dir, path } = await projectWithRef('production', FULL);

    const run = await runPolicy(dir, ['delete', 'production', 'dataProtection.dataLoss']);

    expect(run.exitCode).toBe(0);
    expect(await readText(path)).toBe(
      refFileText({
        formatVersion: 1,
        hash: HASH_A,
        invariants: [],
        policies: {
          change: ['migrate'],
          dataProtection: { accessWidening: 'access-widening-permitted' },
        },
      }),
    );
  });

  it('removes settings named by their flag names, and an object left empty', async () => {
    const { dir, path } = await projectWithRef('production', FULL);

    await runPolicy(dir, ['delete', 'production', 'data-loss', 'access-widening']);

    expect(JSON.parse(await readText(path))).toEqual({
      ...PLAIN_REF,
      policies: { change: ['migrate'] },
    });
  });

  it('removes the policies field once nothing is left in it', async () => {
    const { dir, path } = await projectWithRef('production', FULL);

    await runPolicy(dir, ['delete', 'production', 'change', 'data-loss', 'access-widening']);

    expect(await readText(path)).toBe(refFileText(PLAIN_REF));
  });

  it('returns the policies left and each removal with its effect', async () => {
    const { dir } = await projectWithRef('production', FULL);

    const run = await runPolicy(dir, [
      'delete',
      'production',
      'change',
      'data-loss',
      'access-widening',
      '--json',
    ]);

    expect(run.presented?.data).toEqual({
      ok: true,
      ref: 'production',
      policies: { change: null, dataProtection: { dataLoss: null, accessWidening: null } },
      changes: [
        { setting: 'change', before: ['migrate'], after: null, effect: 'loosens' },
        {
          setting: 'dataProtection.dataLoss',
          before: 'data-loss-forbidden',
          after: null,
          effect: 'loosens',
        },
        {
          setting: 'dataProtection.accessWidening',
          before: 'access-widening-permitted',
          after: null,
          effect: 'unchanged',
        },
      ],
    });
  });

  it.each([
    ['the default', { dataProtection: { dataLoss: 'data-loss-with-consent' } }, 'unchanged'],
    [
      'a level looser than the default',
      { dataProtection: { dataLoss: 'data-loss-permitted' } },
      'unchanged',
    ],
    [
      'a level stricter than the default',
      { dataProtection: { dataLoss: 'data-loss-forbidden' } },
      'loosens',
    ],
  ] as const)('labels removing %s as %s', async (_name, policies, effect) => {
    const { dir } = await projectWithRef('production', { ...PLAIN_REF, policies });

    const run = await runPolicy(dir, ['delete', 'production', 'data-loss', '--json']);
    const document = run.presented?.data as { changes: readonly { effect: string }[] };

    expect(document.changes.map((change) => change.effect)).toEqual([effect]);
  });

  it('labels removing the default change list as unchanged', async () => {
    const { dir } = await projectWithRef('production', {
      ...PLAIN_REF,
      policies: { change: ['reconcile', 'migrate'] },
    });

    const run = await runPolicy(dir, ['delete', 'production', 'change', '--json']);
    const document = run.presented?.data as { changes: readonly { effect: string }[] };

    expect(document.changes.map((change) => change.effect)).toEqual(['unchanged']);
  });

  it('writes nothing when the ref declares none of the settings named', async () => {
    const handWritten = JSON.stringify(
      { ...PLAIN_REF, policies: { change: ['migrate'] } },
      null,
      4,
    );
    const { dir, path } = await projectWithRef('production', handWritten);

    const run = await runPolicy(dir, ['delete', 'production', 'data-loss', '--json']);

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ changes: [] });
    expect(await readText(path)).toBe(handWritten);
  });

  it('shows a removed setting as not declared, so a row never shows two values as unchanged', async () => {
    const { dir } = await projectWithRef('staging', FULL);

    const run = await harness().run(
      ['migration', 'ref', 'policy', 'delete', 'staging', 'data-loss', 'access-widening'],
      { cwd: dir, isTty: { stdout: true, stderr: true } },
    );
    const rendered = stripAnsi(run.stderr)
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.includes('→'));

    expect(rendered).toEqual([
      'dataProtection.dataLoss:        data-loss-forbidden  →  not declared  loosens',
      'dataProtection.accessWidening:  access-widening-permitted  →  not declared  unchanged',
    ]);
  });

  it('says the ref declares none of the settings when there is nothing to remove', async () => {
    const { dir } = await projectWithRef('production', {
      ...PLAIN_REF,
      policies: { change: ['migrate'] },
    });

    const run = await runPolicy(dir, ['delete', 'production', 'access-widening']);

    expect(run.presented?.presentation.human).toEqual([
      {
        kind: 'summary',
        status: 'info',
        text: [
          { text: 'Nothing changed: ref ' },
          { text: 'production', tone: 'ref' },
          { text: ' declares none of these settings. No file was written.' },
        ],
      },
    ]);
  });

  it('says which settings deploys stop comparing, and that no database changed', async () => {
    const { dir } = await projectWithRef('staging', FULL);

    const run = await runPolicy(dir, ['delete', 'staging', 'change']);

    expect(run.presented?.presentation.human.at(-1)).toEqual({
      kind: 'summary',
      status: 'info',
      text: 'No database was changed. Deploys to staging no longer compare change with the database.',
    });
  });

  it('says which forbidden settings migration plan stops checking', async () => {
    const { dir } = await projectWithRef('staging', FULL);

    const run = await runPolicy(dir, ['delete', 'staging', 'data-loss', 'access-widening']);

    expect(run.presented?.presentation.human.at(-1)).toEqual({
      kind: 'summary',
      status: 'info',
      text: 'No database was changed. Deploys to staging no longer compare dataProtection.dataLoss and dataProtection.accessWidening with the database. prisma-test migration plan --to staging no longer checks plans against dataProtection.dataLoss.',
    });
  });

  it('says why it refuses an empty delete', async () => {
    const { dir } = await projectWithRef('production', FULL);

    const run = await runPolicy(dir, ['delete', 'production', '--json']);

    expect(run.json.at(-1)).toMatchObject({
      envelope: {
        error: { summary: 'No setting to delete', why: 'No setting was named to remove.' },
        nextActions: [
          {
            kind: 'user-choice',
            label:
              'Name at least one setting after the ref name: change, dataProtection.dataLoss, dataProtection.accessWidening, data-loss or access-widening.',
          },
        ],
      },
    });
  });

  it('succeeds with no migrations directory and another ref file invalid', async () => {
    const { dir } = await projectWithRef('production', FULL);
    await writeRefText(dir, 'broken', '{ not json');

    const run = await runPolicy(dir, ['delete', 'production', 'change']);

    expect(run.exitCode).toBe(0);
  });

  describe('fails, leaving the file as it was', () => {
    it.each([
      ['no setting', ['production'], 'CLI.INVALID_ARGUMENTS'],
      ['a setting that does not exist', ['production', 'dataLoss'], 'CLI.INVALID_ARGUMENTS'],
      [
        'a setting among valid ones that does not exist',
        ['production', 'change', 'push'],
        'CLI.INVALID_ARGUMENTS',
      ],
      ['a ref file that is not valid', ['broken', 'change'], 'MIGRATION.INVALID_REF_FILE'],
      ['the head ref', ['head', 'change'], 'CLI.INVALID_ARGUMENTS'],
    ] as const)('for %s', async (_name, args, code) => {
      const { dir, path } = await projectWithRef('production', FULL);
      const brokenPath = await writeRefText(dir, 'broken', {
        ...PLAIN_REF,
        policies: { change: [] },
      });
      const headPath = await writeRefText(dir, 'head', PLAIN_REF);
      const before = await Promise.all([path, brokenPath, headPath].map(readText));

      const run = await runPolicy(dir, ['delete', ...args, '--json']);

      expect(run.exitCode).toBe(2);
      expect(run.json.at(-1)).toMatchObject({ envelope: { ok: false, error: { code } } });
      expect(await Promise.all([path, brokenPath, headPath].map(readText))).toEqual(before);
    });

    it('for a ref file with a field the ref format does not have', async () => {
      const unknownField = JSON.stringify({ ...FULL, extra: 1 });
      const { dir, path } = await projectWithRef('production', unknownField);

      const run = await runPolicy(dir, ['delete', 'production', 'change', '--json']);

      expect(run.exitCode).toBe(2);
      expect(run.json.at(-1)).toMatchObject({
        envelope: {
          ok: false,
          error: {
            code: 'MIGRATION.INVALID_REF_FILE',
            why: expect.stringContaining('extra must be removed'),
          },
          nextActions: [
            {
              kind: 'user-choice',
              label: expect.stringContaining('{ "formatVersion": 1, "hash"'),
            },
          ],
        },
      });
      expect(await readText(path)).toBe(unknownField);
    });

    it('for a ref that does not exist', async () => {
      const { dir } = await projectWithRef('production', FULL);

      const run = await runPolicy(dir, ['delete', 'staging', 'change', '--json']);

      expect(run.exitCode).toBe(2);
      expect(run.json.at(-1)).toMatchObject({
        envelope: { ok: false, error: { code: 'MIGRATION.UNKNOWN_REF' } },
      });
    });
  });

  it('is not reached by ref delete given a setting: that fails and keeps the ref', async () => {
    const { dir } = await projectWithRef('staging', FULL);

    const run = await harness().run(
      ['migration', 'ref', 'delete', 'staging', 'data-loss', '--json'],
      {
        cwd: dir,
      },
    );

    expect(run.exitCode).toBe(2);
    expect(existsSync(refPointerPath(dir, 'staging'))).toBe(true);
  });
});
