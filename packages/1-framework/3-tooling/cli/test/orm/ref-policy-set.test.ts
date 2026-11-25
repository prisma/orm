import stripAnsi from 'strip-ansi';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupRefProjects, HASH_A, harness } from './ref-fixtures';
import {
  PLAIN_REF,
  projectWithRef,
  readText,
  refFileText,
  runPolicy,
  writeRefText,
} from './ref-policy-fixtures';

afterEach(cleanupRefProjects);

describe('ref policy set', () => {
  it('writes only the named settings, in the ref format, keeping the other fields and dropping unknown keys', async () => {
    const { dir, path } = await projectWithRef('production', {
      extra: true,
      policies: { dataProtection: { accessWidening: 'access-widening-permitted' } },
      invariants: ['split-user-name'],
      hash: HASH_A,
    });

    const run = await runPolicy(dir, [
      'set',
      'production',
      '--data-loss',
      'forbidden',
      '--change',
      'migrate',
    ]);

    expect(run.exitCode).toBe(0);
    expect(await readText(path)).toBe(
      refFileText({
        hash: HASH_A,
        invariants: ['split-user-name'],
        policies: {
          change: ['migrate'],
          dataProtection: {
            dataLoss: 'data-loss-forbidden',
            accessWidening: 'access-widening-permitted',
          },
        },
      }),
    );
  });

  it('returns the declared policies and each change with its effect', async () => {
    const { dir } = await projectWithRef('production', PLAIN_REF);

    const run = await runPolicy(dir, [
      'set',
      'production',
      '--change',
      'migrate',
      '--data-loss',
      'forbidden',
      '--json',
    ]);

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toEqual({
      ok: true,
      ref: 'production',
      policies: {
        change: ['migrate'],
        dataProtection: { dataLoss: 'data-loss-forbidden', accessWidening: null },
      },
      changes: [
        { setting: 'change', before: null, after: ['migrate'], effect: 'tightens' },
        {
          setting: 'dataProtection.dataLoss',
          before: null,
          after: 'data-loss-forbidden',
          effect: 'tightens',
        },
      ],
    });
  });

  it('stores the change strategies without repeats, in a fixed order', async () => {
    const { dir, path } = await projectWithRef('staging', PLAIN_REF);

    await runPolicy(dir, [
      'set',
      'staging',
      '--change',
      'reconcile',
      '--change',
      'migrate',
      '--change',
      'reconcile',
    ]);

    expect(JSON.parse(await readText(path))).toEqual({
      ...PLAIN_REF,
      policies: { change: ['migrate', 'reconcile'] },
    });
  });

  it('keeps the declared change policy when --change is not given', async () => {
    const { dir, path } = await projectWithRef('production', {
      ...PLAIN_REF,
      policies: { change: ['migrate'] },
    });

    const run = await runPolicy(dir, ['set', 'production', '--access-widening', 'forbidden']);

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(await readText(path))).toEqual({
      ...PLAIN_REF,
      policies: {
        change: ['migrate'],
        dataProtection: { accessWidening: 'access-widening-forbidden' },
      },
    });
  });

  it('accepts the long form of a level', async () => {
    const { dir, path } = await projectWithRef('production', PLAIN_REF);

    const run = await runPolicy(dir, ['set', 'production', '--data-loss', 'data-loss-permitted']);

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(await readText(path))).toMatchObject({
      policies: { dataProtection: { dataLoss: 'data-loss-permitted' } },
    });
  });

  describe('labels each change by what it does to the policy in effect', () => {
    it.each([
      [
        'a stricter level over a declared one',
        { dataProtection: { dataLoss: 'data-loss-permitted' } },
        ['--data-loss', 'with-consent'],
        'tightens',
      ],
      [
        'a looser level over a declared one',
        { dataProtection: { dataLoss: 'data-loss-forbidden' } },
        ['--data-loss', 'permitted'],
        'loosens',
      ],
      [
        'a stricter level where nothing is declared',
        undefined,
        ['--access-widening', 'forbidden'],
        'tightens',
      ],
      [
        'a looser level where nothing is declared',
        undefined,
        ['--access-widening', 'permitted'],
        'loosens',
      ],
      [
        'the default where nothing is declared',
        undefined,
        ['--data-loss', 'with-consent'],
        'unchanged',
      ],
      [
        'fewer strategies over a declared list',
        { change: ['migrate', 'reconcile'] },
        ['--change', 'migrate'],
        'tightens',
      ],
      [
        'an added strategy over a declared list',
        { change: ['migrate'] },
        ['--change', 'migrate', '--change', 'reconcile'],
        'loosens',
      ],
      [
        'another strategy over a declared one',
        { change: ['migrate'] },
        ['--change', 'reconcile'],
        'loosens',
      ],
      [
        'fewer strategies where nothing is declared',
        undefined,
        ['--change', 'reconcile'],
        'tightens',
      ],
      [
        'the default list where nothing is declared',
        undefined,
        ['--change', 'migrate', '--change', 'reconcile'],
        'unchanged',
      ],
    ] as const)('%s', async (_name, policies, flags, effect) => {
      const { dir } = await projectWithRef('production', {
        ...PLAIN_REF,
        ...(policies === undefined ? {} : { policies }),
      });

      const run = await runPolicy(dir, ['set', 'production', ...flags, '--json']);
      const document = run.presented?.data as { changes: readonly { effect: string }[] };

      expect(run.exitCode).toBe(0);
      expect(document.changes.map((change) => change.effect)).toEqual([effect]);
    });
  });

  it('writes a declaration of the default, which changes what the file declares', async () => {
    const { dir, path } = await projectWithRef('production', PLAIN_REF);

    const run = await runPolicy(dir, ['set', 'production', '--data-loss', 'with-consent']);

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(await readText(path))).toEqual({
      ...PLAIN_REF,
      policies: { dataProtection: { dataLoss: 'data-loss-with-consent' } },
    });
  });

  it('writes nothing when every declared value would stay the same', async () => {
    const handWritten = JSON.stringify(
      { hash: HASH_A, invariants: [], policies: { change: ['reconcile', 'migrate'] } },
      null,
      4,
    );
    const { dir, path } = await projectWithRef('production', handWritten);

    const run = await runPolicy(dir, [
      'set',
      'production',
      '--change',
      'migrate',
      '--change',
      'reconcile',
      '--json',
    ]);

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ changes: [] });
    expect(await readText(path)).toBe(handWritten);
  });

  it('succeeds with no migrations directory and another ref file invalid', async () => {
    const { dir, path } = await projectWithRef('production', PLAIN_REF);
    await writeRefText(dir, 'broken', '{ not json');

    const run = await runPolicy(dir, ['set', 'production', '--change', 'migrate']);

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(await readText(path))).toMatchObject({ policies: { change: ['migrate'] } });
  });

  describe('fails, leaving the file as it was', () => {
    it.each([
      ['a value no setting accepts', ['--data-loss', 'never'], 'CLI.INVALID_ARGUMENTS'],
      [
        "the other setting's long form",
        ['--data-loss', 'access-widening-forbidden'],
        'CLI.INVALID_ARGUMENTS',
      ],
      [
        'an access-widening level that does not exist',
        ['--access-widening', 'never'],
        'CLI.INVALID_ARGUMENTS',
      ],
      ['a strategy that does not exist', ['--change', 'push'], 'CLI.INVALID_ARGUMENTS'],
      ['comma-separated strategies', ['--change', 'migrate,reconcile'], 'CLI.INVALID_ARGUMENTS'],
      ['no setting at all', [], 'CLI.INVALID_ARGUMENTS'],
    ] as const)('for %s', async (_name, flags, code) => {
      const { dir, path } = await projectWithRef('production', PLAIN_REF);
      const before = await readText(path);

      const run = await runPolicy(dir, ['set', 'production', ...flags, '--json']);

      expect(run.exitCode).toBe(2);
      expect(run.json.at(-1)).toMatchObject({ envelope: { ok: false, error: { code } } });
      expect(await readText(path)).toBe(before);
    });

    it('names the allowed levels', async () => {
      const { dir } = await projectWithRef('production', PLAIN_REF);

      const run = await runPolicy(dir, ['set', 'production', '--data-loss', 'never', '--json']);

      expect(run.json.at(-1)).toMatchObject({
        envelope: {
          error: {
            summary: '--data-loss does not accept "never"',
            why: '--data-loss takes forbidden, with-consent or permitted, or the same with data-loss- in front.',
            meta: {
              flag: '--data-loss',
              value: 'never',
              allowed: ['forbidden', 'with-consent', 'permitted'],
            },
          },
        },
      });
    });

    it('for a ref that does not exist', async () => {
      const { dir } = await projectWithRef('production', PLAIN_REF);

      const run = await runPolicy(dir, ['set', 'staging', '--change', 'migrate', '--json']);

      expect(run.exitCode).toBe(2);
      expect(run.json.at(-1)).toMatchObject({
        envelope: { ok: false, error: { code: 'MIGRATION.UNKNOWN_REF' } },
      });
    });

    it('for the head ref', async () => {
      const { dir, path } = await projectWithRef('head', PLAIN_REF);
      const before = await readText(path);

      const run = await runPolicy(dir, ['set', 'head', '--change', 'migrate', '--json']);

      expect(run.exitCode).toBe(2);
      expect(run.json.at(-1)).toMatchObject({
        envelope: {
          ok: false,
          error: {
            code: 'CLI.INVALID_ARGUMENTS',
            summary: 'The head ref cannot declare policies',
            why: 'head is the ref the CLI keeps at the newest contract; a team does not declare policies for it.',
          },
          nextActions: [
            {
              kind: 'user-choice',
              label: 'Name a ref your team keeps for a database, such as staging or production.',
            },
          ],
        },
      });
      expect(await readText(path)).toBe(before);
    });

    it('for a ref file that is not valid', async () => {
      const invalid = JSON.stringify({ ...PLAIN_REF, policies: { change: ['push'] } });
      const { dir, path } = await projectWithRef('production', invalid);

      const run = await runPolicy(dir, ['set', 'production', '--data-loss', 'forbidden', '--json']);

      expect(run.exitCode).toBe(2);
      expect(run.json.at(-1)).toMatchObject({
        envelope: { ok: false, error: { code: 'MIGRATION.INVALID_REF_FILE' } },
      });
      expect(await readText(path)).toBe(invalid);
    });
  });

  it('prints each change, and says that no database changed', async () => {
    const { dir } = await projectWithRef('production', PLAIN_REF);

    const run = await harness().run(
      [
        'migration',
        'ref',
        'policy',
        'set',
        'production',
        '--change',
        'migrate',
        '--data-loss',
        'forbidden',
      ],
      { cwd: dir, isTty: { stdout: true, stderr: true } },
    );
    const rendered = stripAnsi(run.stderr)
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    expect(rendered).toEqual([
      '✔ Updated the policies ref production declares (migrations/app/refs/production.json)',
      'change:                   migrate, reconcile (default)  →  migrate  tightens',
      'dataProtection.dataLoss:  data-loss-with-consent (default)  →  data-loss-forbidden  tightens',
      "ℹ No database was changed. A database takes on these policies only when its owner applies them in a deploy to production; until then, deploys to production refuse while the database's policies differ. prisma-test migration plan --to production now checks plans against dataProtection.dataLoss.",
    ]);
  });

  it('says migration plan stops checking a setting moved away from forbidden', async () => {
    const { dir } = await projectWithRef('production', {
      ...PLAIN_REF,
      policies: { dataProtection: { dataLoss: 'data-loss-forbidden' } },
    });

    const run = await harness().run(
      ['migration', 'ref', 'policy', 'set', 'production', '--data-loss', 'with-consent'],
      { cwd: dir },
    );

    expect(run.presented?.presentation.human.at(-1)).toEqual({
      kind: 'summary',
      status: 'info',
      text: "No database was changed. A database takes on these policies only when its owner applies them in a deploy to production; until then, deploys to production refuse while the database's policies differ. prisma-test migration plan --to production no longer checks plans against dataProtection.dataLoss.",
    });
  });

  it('names migration plan only for a setting it now checks', async () => {
    const { dir } = await projectWithRef('production', PLAIN_REF);

    const run = await runPolicy(dir, ['set', 'production', '--data-loss', 'permitted']);

    expect(run.presented?.presentation.human.at(-1)).toEqual({
      kind: 'summary',
      status: 'info',
      text: "No database was changed. A database takes on these policies only when its owner applies them in a deploy to production; until then, deploys to production refuse while the database's policies differ.",
    });
  });

  it('says so when nothing changed', async () => {
    const { dir } = await projectWithRef('production', {
      ...PLAIN_REF,
      policies: { change: ['migrate'] },
    });

    const run = await runPolicy(dir, ['set', 'production', '--change', 'migrate']);

    expect(run.exitCode).toBe(0);
    expect(run.presented?.presentation.human).toEqual([
      {
        kind: 'summary',
        status: 'info',
        text: [
          { text: 'Nothing changed: ref ' },
          { text: 'production', tone: 'ref' },
          { text: ' already declares these policies. No file was written.' },
        ],
      },
    ]);
  });

  it('prints one line per declared setting on stdout', async () => {
    const { dir } = await projectWithRef('production', {
      ...PLAIN_REF,
      policies: { dataProtection: { accessWidening: 'access-widening-forbidden' } },
    });

    const run = await runPolicy(dir, [
      'set',
      'production',
      '--change',
      'migrate',
      '--change',
      'reconcile',
    ]);

    expect(run.stdout).toBe(
      'change\tmigrate,reconcile\ndataProtection.accessWidening\taccess-widening-forbidden\n',
    );
  });
});
