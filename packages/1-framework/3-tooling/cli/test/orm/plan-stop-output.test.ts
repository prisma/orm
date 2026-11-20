import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HASH_FROM, HASH_TO, harness } from './fixtures/migration-plan-project';
import {
  ADDITIVE_OP,
  createOfflineProject,
  DESTRUCTIVE_OP,
  type FakePlannerScript,
  type OfflineProject,
  removeOfflineProjects,
  resetRenderContractDtsMock,
  seedContractSnapshot,
  seedDbRef,
  seedMigrationPackage,
} from './fixtures/offline-project';

beforeEach(resetRenderContractDtsMock);
afterEach(removeOfflineProjects);

const DROP_LEGACY = { ...DESTRUCTIVE_OP, label: 'Drop column "legacy" from "Store Front"' };

/** A project whose database is at a contract where Shop has `legacy`, and whose contract has `rating` instead. */
async function shopProject(): Promise<OfflineProject> {
  const project = await createOfflineProject({
    storageHash: HASH_TO,
    models: [{ name: 'Shop', fields: ['id', 'rating'] }],
  });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '20260101T0000_initial',
    from: null,
    to: HASH_FROM,
  });
  await seedContractSnapshot({
    migrationsDir: project.migrationsDir,
    storageHash: HASH_FROM,
    models: [{ name: 'Shop', fields: ['id', 'legacy'] }],
  });
  await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });
  return project;
}

const removedLegacy: FakePlannerScript = {
  operations: [ADDITIVE_OP, DROP_LEGACY],
  dataLoss: [
    {
      operationIndex: 1,
      subject: { kind: 'field', namespaceId: 'app', model: 'Shop', field: 'legacy' },
    },
  ],
};

function errorOf(run: { readonly json: readonly unknown[] }): unknown {
  const terminal = run.json.at(-1) as
    | { readonly kind: string; readonly envelope?: { readonly error?: unknown } }
    | undefined;
  return terminal?.kind === 'result' ? terminal.envelope?.error : undefined;
}

const LEGACY_ANSWERS = [
  {
    kind: 'user-choice',
    label:
      'If the field was renamed to "rating", keep its values: --rename Shop.legacy:Shop.rating',
  },
  { kind: 'user-choice', label: 'If the values can go: --delete Shop.legacy' },
];

const LEGACY_META = {
  subject: 'Shop.legacy',
  verbs: ['rename', 'delete'],
  unanswered: [{ subject: 'Shop.legacy', verbs: ['rename', 'delete'] }],
};

describe('the output when migration plan stops to ask and nobody can answer', () => {
  it('says what the change would do, what the plan would run, and what each flag means', async () => {
    const project = await shopProject();

    const run = await harness(project, { script: removedLegacy }).run(['migration', 'plan'], {
      cwd: project.dir,
    });

    expect({ exitCode: run.exitCode, stderr: run.stderr }).toEqual({
      exitCode: 2,
      stderr: [
        '✘ [CLI.CONSENT_REQUIRED] Removing field "Shop.legacy" would delete its values.',
        '  why: The operation of the plan that does this: Drop column "legacy" from "Store Front".',
        '→ If the field was renamed to "rating", keep its values: --rename Shop.legacy:Shop.rating',
        '→ If the values can go: --delete Shop.legacy',
        '',
      ].join('\n'),
    });
  });

  it('says to remove the flags that did nothing, before the flags to give', async () => {
    const project = await shopProject();

    const run = await harness(project, { script: removedLegacy }).run(
      ['migration', 'plan', '--delete', 'nope', '--confirm', 'postgres', '--json'],
      { cwd: project.dir },
    );

    expect(errorOf(run)).toEqual({
      code: 'CLI.CONSENT_REQUIRED',
      severity: 'error',
      summary: 'Removing field "Shop.legacy" would delete its values.',
      why: 'The operation of the plan that does this: Drop column "legacy" from "Store Front".',
      nextActions: [
        {
          kind: 'user-choice',
          label: 'Remove --delete nope: nothing in this change is called that.',
        },
        {
          kind: 'user-choice',
          label: 'Remove --confirm postgres: nothing in this change needs it.',
        },
        ...LEGACY_ANSWERS,
      ],
      meta: {
        ...LEGACY_META,
        unmatched: [{ verb: 'delete', values: ['nope'] }],
        confirm: ['postgres'],
      },
    });
  });

  it('says --yes does not allow it, because it would delete data', async () => {
    const project = await shopProject();

    const run = await harness(project, { script: removedLegacy }).run(
      ['migration', 'plan', '--yes', '--json'],
      { cwd: project.dir },
    );

    expect(errorOf(run)).toEqual({
      code: 'CLI.CONSENT_REQUIRED',
      severity: 'error',
      summary: 'Removing field "Shop.legacy" would delete its values.',
      why: [
        'The operation of the plan that does this: Drop column "legacy" from "Store Front".',
        '',
        '--yes does not allow this: it would delete data.',
      ].join('\n'),
      nextActions: LEGACY_ANSWERS,
      meta: LEGACY_META,
    });
  });

  it('offers to convert or cast a field whose type changes', async () => {
    const project = await shopProject();
    const retype: FakePlannerScript = {
      operations: [
        ADDITIVE_OP,
        { ...DESTRUCTIVE_OP, label: 'Alter type of "Store Front"."id" to int4' },
      ],
      dataLoss: [
        {
          operationIndex: 1,
          loss: 'typeChange',
          subject: { kind: 'field', namespaceId: 'app', model: 'Shop', field: 'id' },
        },
      ],
    };

    const run = await harness(project, { script: retype }).run(
      ['migration', 'plan', '--yes', '--json'],
      { cwd: project.dir },
    );

    expect(errorOf(run)).toEqual({
      code: 'CLI.CONSENT_REQUIRED',
      severity: 'error',
      summary: 'Changing the type of field "Shop.id" can change or lose its values.',
      why: [
        'The operation of the plan that does this: Alter type of "Store Front"."id" to int4.',
        '',
        '--yes does not allow this: it can change or lose data.',
      ].join('\n'),
      nextActions: [
        { kind: 'user-choice', label: 'To write the conversion yourself: --convert Shop.id' },
        {
          kind: 'user-choice',
          label:
            'To let the database cast the values, which can change or lose some: --delete Shop.id',
        },
      ],
      meta: {
        subject: 'Shop.id',
        verbs: ['convert', 'delete'],
        unanswered: [{ subject: 'Shop.id', verbs: ['convert', 'delete'] }],
      },
    });
  });
});

/** The flags a next action gives, as a shell reads them: the text after its last `: --`. */
function flagsOf(label: string): readonly string[] {
  const at = label.lastIndexOf(': --');
  const command = label.slice(at + 2).replace(/\.$/, '');
  return [...command.matchAll(/'([^']*)'|(\S+)/g)].map(([, quoted, bare]) => quoted ?? bare ?? '');
}

function labelsOf(error: unknown): readonly string[] {
  return ((error as { readonly nextActions?: readonly { label: string }[] }).nextActions ?? []).map(
    ({ label }) => label,
  );
}

describe('following a printed line of the output when migration plan stops', () => {
  it('plans the change once each flag the output says to remove is gone and the printed --delete is given', async () => {
    const project = await shopProject();
    const given = [
      ['--delete', 'nope'],
      ['--confirm', 'postgres'],
    ] as const;
    const refused = await harness(project, { script: removedLegacy }).run(
      ['migration', 'plan', ...given.flat(), '--json'],
      { cwd: project.dir },
    );
    const labels = labelsOf(errorOf(refused));
    const removed = labels.filter((label) => label.startsWith('Remove '));
    const remaining = given
      .filter(
        ([flag, value]) => !removed.some((label) => label.startsWith(`Remove ${flag} ${value}:`)),
      )
      .flat();
    const deleteLine = labels.find((label) => label.endsWith('--delete Shop.legacy')) ?? '';

    const followed = await harness(project, { script: removedLegacy }).run(
      ['migration', 'plan', ...remaining, ...flagsOf(deleteLine)],
      { cwd: project.dir },
    );

    expect({ removed, remaining, exitCode: followed.exitCode }).toEqual({
      removed: [
        'Remove --delete nope: nothing in this change is called that.',
        'Remove --confirm postgres: nothing in this change needs it.',
      ],
      remaining: [],
      exitCode: 0,
    });
  });

  it('plans the change with --yes once the printed --delete is given', async () => {
    const project = await shopProject();
    const refused = await harness(project, { script: removedLegacy }).run(
      ['migration', 'plan', '--yes', '--json'],
      { cwd: project.dir },
    );
    const deleteLine = labelsOf(errorOf(refused)).find((label) => label.includes('--delete')) ?? '';

    const followed = await harness(project, { script: removedLegacy }).run(
      ['migration', 'plan', '--yes', ...flagsOf(deleteLine)],
      { cwd: project.dir },
    );

    expect(followed.exitCode).toBe(0);
  });

  it('plans the rename the printed --rename gives', async () => {
    const project = await shopProject();
    const script = { ...removedLegacy, statementsResolveDataLoss: true };
    const refused = await harness(project, { script }).run(['migration', 'plan', '--json'], {
      cwd: project.dir,
    });
    const renameLine = labelsOf(errorOf(refused)).find((label) => label.includes('--rename'));

    const followed = await harness(project, { script }).run(
      ['migration', 'plan', ...flagsOf(renameLine ?? '')],
      { cwd: project.dir },
    );

    expect({ flags: flagsOf(renameLine ?? ''), exitCode: followed.exitCode }).toEqual({
      flags: ['--rename', 'Shop.legacy:Shop.rating'],
      exitCode: 0,
    });
  });
});

describe('the output when a flag names the subject in a form it does not take', () => {
  it('says what was given, why it does not fit, and what the change would do', async () => {
    const project = await shopProject();

    const run = await harness(project, { script: removedLegacy }).run(
      ['migration', 'plan', '--delete', 'Shop.legacy:x', '--json'],
      { cwd: project.dir },
    );

    expect(errorOf(run)).toEqual({
      code: 'CLI.PROMPT_INVALID',
      severity: 'error',
      summary: '--delete Shop.legacy:x does not fit this change: give it as --delete Shop.legacy.',
      why: 'Removing field "Shop.legacy" would delete its values.',
      nextActions: [],
    });
  });
});
