import { asNamespaceId } from '@internal/contract/types';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  accessChangeQuestion,
  dataLossQuestion,
} from '../../src/control-api/statements/plan-questions';
import {
  answers,
  askThenApply,
  contracts,
  envelopeOf,
  harness,
  mocks,
  ormConfig,
  project,
  removeProjects,
  setUpProject,
} from './fixtures/db-update-consent-project';

beforeEach(setUpProject);
afterAll(removeProjects);

describe('db update questions', () => {
  it('refuses where nobody can answer, listing every question across spaces with its flags', async () => {
    const run = await harness().run(['db', 'update', '--json'], { cwd: project.dir });

    expect(run.exitCode).toBe(2);
    expect((envelopeOf(run.json) as { readonly error: unknown }).error).toEqual({
      code: 'CLI.CONSENT_REQUIRED',
      severity: 'error',
      summary:
        'This change would lose data and change access: "audit_old", model "Legacy", model "User".',
      why: [
        'This change would delete the data in "audit_old", which no model of the contract before this change stores.',
        'The operation of the plan that does this: Drop table "audit_old".',
        '',
        'Removing model "Legacy" would delete its data.',
        'The operation of the plan that does this: Drop table "Legacy".',
        '',
        'Access to the data of "User" would widen.',
        'The operation of the plan that does this: Disable row-level security on "User".',
      ].join('\n'),
      nextActions: [
        { kind: 'user-choice', label: 'If the data in "audit_old" can go: --delete audit_old' },
        {
          kind: 'user-choice',
          label: `If model "Legacy" was renamed, add it to the contract under its new name and run \`prisma-test contract emit\`; then keep its data: --rename 'Legacy:<new name>'`,
        },
        { kind: 'user-choice', label: 'If the data of model "Legacy" can go: --delete Legacy' },
        { kind: 'user-choice', label: 'To allow the change to model "User": --allow User' },
      ],
      meta: {
        unanswered: [
          { subject: 'audit_old', verbs: ['delete'] },
          { subject: 'Legacy', verbs: ['rename', 'delete'] },
          { subject: 'User', verbs: ['allow'] },
        ],
      },
    });
  });

  it('asks once about every access change of a model, and one --allow allows them all', async () => {
    const userAccess = (operationIndex: number, label: string) => ({
      operationIndex,
      label,
      subject: { kind: 'model', namespaceId: asNamespaceId('app'), model: 'User' } as const,
      widens: true,
    });
    mocks.dbUpdate.mockImplementation(
      askThenApply(() => [
        accessChangeQuestion(
          [
            userAccess(0, 'Disable row-level security on "User"'),
            userAccess(1, 'Drop policy "readers" on "User"'),
          ],
          contracts,
        ),
      ]),
    );

    const refused = await harness().run(['db', 'update', '--json'], { cwd: project.dir });
    const applied = await harness().run(['db', 'update', '--allow', 'User', '--json'], {
      cwd: project.dir,
    });

    expect((envelopeOf(refused.json) as { readonly error: unknown }).error).toEqual({
      code: 'CLI.CONSENT_REQUIRED',
      severity: 'error',
      summary: 'Access to the data of "User" would widen.',
      why: [
        'The operations of the plan that do this:',
        '- Disable row-level security on "User"',
        '- Drop policy "readers" on "User"',
      ].join('\n'),
      nextActions: [{ kind: 'user-choice', label: 'To allow both changes: --allow User' }],
      meta: {
        subject: 'User',
        verbs: ['allow'],
        unanswered: [{ subject: 'User', verbs: ['allow'] }],
      },
    });
    expect({ exitCode: applied.exitCode, answers }).toEqual({
      exitCode: 0,
      answers: [{ verb: 'allow', text: 'User' }],
    });
  });

  it('gives a value the subject it equals when another subject is its prefix', async () => {
    mocks.dbUpdate.mockImplementation(
      askThenApply(() => [
        dataLossQuestion(
          {
            operationIndex: 0,
            label: 'Drop table "Legacy"',
            subject: { kind: 'model', namespaceId: asNamespaceId('app'), model: 'Legacy' },
            loss: 'drop',
          },
          contracts,
        ),
        dataLossQuestion(
          {
            operationIndex: 1,
            label: 'Drop table "Legacy:x"',
            subject: { kind: 'storage', name: 'Legacy:x' },
            loss: 'drop',
          },
          contracts,
        ),
      ]),
    );

    const run = await harness().run(
      ['db', 'update', '--delete', 'Legacy:x', '--delete', 'Legacy', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(answers).toEqual([
      { verb: 'delete', text: 'Legacy' },
      { verb: 'delete', text: 'Legacy:x' },
    ]);
  });

  it('applies once every question is answered with flags', async () => {
    const run = await harness().run(
      ['db', 'update', '--delete', 'audit_old', '--delete', 'Legacy', '--allow', 'User', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(answers).toEqual([
      { verb: 'delete', text: 'audit_old' },
      { verb: 'delete', text: 'Legacy' },
      { verb: 'allow', text: 'User' },
    ]);
  });

  it('refuses an apply that widens access without --allow', async () => {
    const run = await harness().run(
      ['db', 'update', '--delete', 'audit_old', '--delete', 'Legacy', '--json'],
      { cwd: project.dir },
    );

    expect(envelopeOf(run.json)).toMatchObject({
      error: {
        code: 'CLI.CONSENT_REQUIRED',
        meta: { unanswered: [{ subject: 'User', verbs: ['allow'] }] },
      },
    });
  });

  it('takes typed answers', async () => {
    const run = await harness().run(['db', 'update', '--json'], {
      cwd: project.dir,
      isTty: { stdin: true },
      answers: ['delete', 'delete', 'allow'],
    });

    expect(run.exitCode).toBe(0);
    expect(answers.map((answer) => answer?.verb)).toEqual(['delete', 'delete', 'allow']);
  });

  it('says to remove --confirm and a stray flag, says --yes does not allow an access change, and applies once the printed flag is given', async () => {
    mocks.dbUpdate.mockImplementation(
      askThenApply(() => [
        accessChangeQuestion(
          [
            {
              operationIndex: 0,
              label: 'Disable row-level security on "User"',
              subject: { kind: 'model', namespaceId: asNamespaceId('app'), model: 'User' },
              widens: true,
            },
          ],
          contracts,
        ),
      ]),
    );
    const errorOf = (run: { readonly json: Parameters<typeof envelopeOf>[0] }) =>
      (envelopeOf(run.json) as { readonly error: unknown }).error;

    const strays = await harness().run(
      ['db', 'update', '--confirm', 'appdb', '--allow', 'Nope', '--json'],
      { cwd: project.dir },
    );
    const yes = await harness().run(['db', 'update', '--yes', '--json'], {
      cwd: project.dir,
      isTty: { stdin: true },
    });
    const followed = await harness().run(['db', 'update', '--yes', '--allow', 'User', '--json'], {
      cwd: project.dir,
      isTty: { stdin: true },
    });

    const refusal = {
      code: 'CLI.CONSENT_REQUIRED',
      severity: 'error',
      summary: 'Access to the data of "User" would widen.',
      meta: {
        subject: 'User',
        verbs: ['allow'],
        unanswered: [{ subject: 'User', verbs: ['allow'] }],
      },
    };
    const allow = { kind: 'user-choice', label: 'To allow it: --allow User' };
    expect([errorOf(strays), errorOf(yes), followed.exitCode]).toEqual([
      {
        ...refusal,
        why: 'The operation of the plan that does this: Disable row-level security on "User".',
        nextActions: [
          {
            kind: 'user-choice',
            label: 'Remove --allow Nope: nothing in this change is called that.',
          },
          {
            kind: 'user-choice',
            label: 'Remove --confirm appdb: nothing in this change needs it.',
          },
          allow,
        ],
        meta: {
          ...refusal.meta,
          unmatched: [{ verb: 'allow', values: ['Nope'] }],
          confirm: ['appdb'],
        },
      },
      {
        ...refusal,
        why: [
          'The operation of the plan that does this: Disable row-level security on "User".',
          '',
          '--yes does not allow this: it would change who can read and write data.',
        ].join('\n'),
        nextActions: [allow],
      },
      0,
    ]);
  });

  it('refuses a --delete of what a --rename of the same run renames, before it plans anything', async () => {
    const run = await harness().run(
      [
        'db',
        'update',
        '--rename',
        'Status.ARCHIVED:Status.RETIRED',
        '--delete',
        'Status.ARCHIVED',
        '--json',
      ],
      { cwd: project.dir },
    );

    expect(run.exitCode).not.toBe(0);
    expect(envelopeOf(run.json)).toMatchObject({
      error: {
        code: 'MIGRATION.STATEMENT_INVALID',
        why: '--delete Status.ARCHIVED names what --rename Status.ARCHIVED:Status.RETIRED renames in the same run, so it cannot also be deleted.',
      },
    });
    expect(mocks.dbUpdate).not.toHaveBeenCalled();
  });

  it('refuses --backfill before it plans anything, naming migration plan and keeping a two-name --convert for the control API to resolve', async () => {
    mocks.readMarker.mockResolvedValueOnce({ storageHash: 'c'.repeat(64) });
    const run = await harness().run(
      [
        'db',
        'update',
        '--rename',
        'User.years:User.age',
        '--convert',
        'User.age',
        '--allow',
        'User',
        '--backfill',
        'User.email',
        '--json',
      ],
      { cwd: project.dir },
    );

    expect(run.exitCode).not.toBe(0);
    expect(envelopeOf(run.json)).toMatchObject({
      error: {
        code: 'MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE',
        nextActions: [
          expect.objectContaining({
            command:
              'prisma-test migration plan --rename User.years:User.age --convert User.age --backfill User.email',
          }),
          expect.anything(),
        ],
        meta: { statements: [{ verb: 'backfill', text: 'User.email' }] },
      },
    });
    expect(mocks.dbUpdate).not.toHaveBeenCalled();
  });

  it('refuses --convert and --backfill within a few seconds when the database never answers', async () => {
    mocks.connect.mockReturnValueOnce(new Promise(() => {}));
    const started = Date.now();
    const run = await harness().run(['db', 'update', '--backfill', 'User.email', '--json'], {
      cwd: project.dir,
    });

    expect(Date.now() - started).toBeLessThan(5000);
    expect(envelopeOf(run.json)).toMatchObject({
      error: {
        code: 'MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE',
        nextActions: [
          expect.objectContaining({ command: 'prisma-test migration plan --backfill User.email' }),
          expect.anything(),
        ],
      },
    });
  }, 10_000);

  it('refuses --convert and --backfill when the database cannot be reached, opening only an existing database', async () => {
    mocks.connect.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:1'));
    const run = await harness().run(['db', 'update', '--backfill', 'User.email', '--json'], {
      cwd: project.dir,
    });

    expect(envelopeOf(run.json)).toMatchObject({
      error: {
        code: 'MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE',
        nextActions: [
          expect.objectContaining({ command: 'prisma-test migration plan --backfill User.email' }),
          expect.anything(),
        ],
      },
    });
    expect(mocks.connect).toHaveBeenCalledWith(expect.anything(), {
      existingDatabaseOnly: true,
      connectTimeoutMs: 3000,
    });
    expect(mocks.dbUpdate).not.toHaveBeenCalled();
  });

  it('refuses a --delete no question asks about', async () => {
    mocks.dbUpdate.mockReset().mockImplementation(askThenApply(() => []));

    const run = await harness().run(['db', 'update', '--delete', 'Nope', '--json'], {
      cwd: project.dir,
    });

    expect(envelopeOf(run.json)).toMatchObject({ error: { code: 'CLI.CONSENT_UNUSED' } });
  });

  it('hands a --convert with one or two names to the control API, which tells a variant from a field', async () => {
    const run = await harness().run(
      ['db', 'update', '--dry-run', '--convert', 'Bug', '--convert', 'app.Epic', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(mocks.dbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        statements: [
          { verb: 'convert', text: 'Bug' },
          { verb: 'convert', text: 'app.Epic' },
        ],
      }),
    );
  });

  it('refuses a --convert with three names before it plans anything, since it names a field', async () => {
    const run = await harness().run(['db', 'update', '--convert', 'app.User.age', '--json'], {
      cwd: project.dir,
    });

    expect(envelopeOf(run.json)).toMatchObject({
      error: {
        code: 'MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE',
        meta: { statements: [{ verb: 'convert', text: 'app.User.age' }] },
      },
    });
    expect(mocks.dbUpdate).not.toHaveBeenCalled();
  });

  it('asks nothing on a dry run, and hands it the delete and allow flags to check', async () => {
    const run = await harness().run(
      ['db', 'update', '--dry-run', '--delete', 'Legacy', '--allow', 'User', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(answers).toEqual([]);
    expect(mocks.dbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'plan',
        statements: [
          { verb: 'delete', text: 'Legacy' },
          { verb: 'allow', text: 'User' },
        ],
      }),
    );
  });

  it('keeps every statement in the retry command when no connection is configured', async () => {
    const run = await harness({ ...ormConfig(), db: undefined }).run(
      [
        'db',
        'update',
        '--rename',
        'Profile:User',
        '--delete',
        'Legacy',
        '--allow',
        'User',
        '--json',
      ],
      { cwd: project.dir },
    );

    expect(envelopeOf(run.json)).toMatchObject({
      error: {
        code: 'CONFIG.DB_CONNECTION_REQUIRED',
        nextActions: [
          expect.objectContaining({
            label: expect.stringContaining(
              'prisma-test db update --rename Profile:User --delete Legacy --allow User --db $DATABASE_URL',
            ),
          }),
        ],
      },
    });
  });
});
