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
        '  why: The plan would run: Drop column "legacy" from "Store Front".',
        '→ If the field was renamed to "rating", keep its values: --rename Shop.legacy:Shop.rating',
        '→ If the values can go: --delete Shop.legacy',
        '',
      ].join('\n'),
    });
  });

  it('names the flags that answered nothing', async () => {
    const project = await shopProject();

    const run = await harness(project, { script: removedLegacy }).run(
      ['migration', 'plan', '--delete', 'nope', '--confirm', 'postgres', '--json'],
      { cwd: project.dir },
    );

    expect(errorOf(run)).toEqual({
      code: 'CLI.CONSENT_REQUIRED',
      severity: 'error',
      summary: 'Removing field "Shop.legacy" would delete its values.',
      why: [
        'The plan would run: Drop column "legacy" from "Store Front".',
        '--delete nope names nothing this change asks about.',
        '--confirm postgres does not answer this.',
      ].join('\n'),
      nextActions: LEGACY_ANSWERS,
      meta: {
        ...LEGACY_META,
        unmatched: [{ verb: 'delete', values: ['nope'] }],
        confirm: ['postgres'],
      },
    });
  });

  it('says --yes does not answer it, because it would delete data', async () => {
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
        'The plan would run: Drop column "legacy" from "Store Front".',
        '--yes does not answer this: it would delete data.',
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
        'The plan would run: Alter type of "Store Front"."id" to int4.',
        '--yes does not answer this: it can change or lose data.',
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
