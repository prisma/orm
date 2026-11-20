import { asNamespaceId } from '@internal/contract/types';
import type { MigrationSubject } from '@internal/framework-components/control';
import type { PromptSurface, StatementSurface } from '@prisma/cli-engine';
import { CliStructuredError } from '@prisma/cli-engine/protocol';
import { describe, expect, it } from 'vitest';
import { questionText, refusalText } from '../../../src/control-api/statements/plan-question-text';
import type {
  KeepDataEditAdvice,
  PlanQuestion,
  PlanQuestionVerb,
} from '../../../src/control-api/statements/plan-questions';
import { resolveStatements } from '../../../src/control-api/statements/resolve-statements';
import { promptPlanQuestions } from '../../../src/orm/plan-question-prompt';
import { errorConsentMisdirected, errorConsentUnused } from '../../../src/utils/cli-errors';
import {
  dbUpdateKeepDataEditAdvice,
  migrationPlanKeepDataEditAdvice,
} from '../../../src/utils/keep-data-edit-advice';
import { askedAbout } from './plan-question-fixtures';
import { contractOf } from './statement-fixtures';

const app = asNamespaceId('app');
const billing = asNamespaceId('billing');
const PROJECT = { cwd: '/work/app', configPath: undefined, dbGiven: false };

const origin = contractOf({
  app: {
    models: {
      Shop: { fields: ['id', 'legacy', 'age', 'status'] },
      Legacy: {},
      Profile: { fields: ['id', 'nickname'] },
      Place: { fields: ['location'], fieldTypes: { location: { valueObject: 'GeoPoint' } } },
      Task: {
        fields: ['type', 'status'],
        discriminator: 'type',
        variants: { bug: 'Bug', story: 'Story' },
      },
      Bug: { base: 'Task' },
      Story: { base: 'Task' },
    },
    enums: { Status: ['OPEN', 'ARCHIVED', 'DONE'] },
    valueObjects: { GeoPoint: ['lat', 'note?'] },
  },
  billing: { models: { Invoice: {} } },
});
const destination = contractOf({
  app: {
    models: {
      Shop: {
        fields: ['id', 'rating', 'age', 'status'],
        fieldTypes: { age: { codecId: 'test/int@1' } },
      },
      Person: { fields: ['id', 'nickname'] },
      Place: { fields: ['location'], fieldTypes: { location: { valueObject: 'GeoPoint' } } },
      Task: { fields: ['type', 'status'], discriminator: 'type', variants: { defect: 'Bug' } },
      Bug: { base: 'Task' },
    },
    enums: { Status: ['OPEN', 'DONE'] },
    valueObjects: { GeoPoint: ['lat', 'height', 'depth'] },
  },
  finance: { models: { Invoice: {} } },
});

const geoPointField = (field: string): MigrationSubject => ({
  kind: 'valueObjectField',
  namespaceId: app,
  valueObject: 'GeoPoint',
  field,
});

/** A question of every kind, with target advice, a field of a renamed model, new required fields and kept enum members. */
function everyKindOfQuestion(
  originKnown: boolean,
  canConvert: boolean,
  keepDataEditAdvice: KeepDataEditAdvice | undefined,
) {
  return askedAbout({
    origin,
    destination,
    originKnown,
    canConvert,
    ...(keepDataEditAdvice === undefined ? {} : { keepDataEditAdvice }),
    temporaryValues: [{ subject: geoPointField('height') }],
    losses: [
      { label: 'Drop "legacy"', subject: { kind: 'model', namespaceId: app, model: 'Legacy' } },
      {
        label: 'Drop "shop"."legacy"',
        subject: { kind: 'field', namespaceId: app, model: 'Shop', field: 'legacy' },
        keepDataAdvice: 'Target advice on keeping it.',
      },
      {
        label: 'Drop "profile"."nickname"',
        subject: { kind: 'field', namespaceId: app, model: 'Profile', field: 'nickname' },
      },
      {
        label: 'Alter "shop"."age"',
        loss: 'typeChange',
        subject: { kind: 'field', namespaceId: app, model: 'Shop', field: 'age' },
      },
      {
        label: 'Remove "archived"',
        subject: { kind: 'enumValue', namespaceId: app, enum: 'Status', member: 'ARCHIVED' },
      },
      {
        label: 'Rewrite "done"',
        subject: { kind: 'enumValue', namespaceId: app, enum: 'Status', member: 'DONE' },
        keepDataEdit: { remove: 'remove done', replaceWith: 'replace done' },
      },
      { label: 'Remove key "note"', subject: geoPointField('note') },
      { label: 'Rewrite "bug"', subject: { kind: 'model', namespaceId: app, model: 'Bug' } },
      {
        label: 'Drop "invoice"',
        subject: { kind: 'model', namespaceId: billing, model: 'Invoice' },
      },
      { label: 'Drop "audit"', subject: { kind: 'storage', name: 'audit' } },
      {
        label: 'Alter "audit_age"',
        loss: 'typeChange',
        subject: { kind: 'storage', name: 'audit_age' },
      },
    ],
    accessChanges: [
      {
        label: 'Disable row-level security on "shop"',
        subject: { kind: 'model', namespaceId: app, model: 'Shop' },
        widens: true,
      },
      {
        label: 'Drop policy "readers" on "shop"',
        subject: { kind: 'model', namespaceId: app, model: 'Shop' },
        widens: false,
      },
    ],
    namespaces: { removed: ['billing'], added: ['finance'] },
  });
}

/** Wrong values for a question: no new name, a new name the contract does not have, one it had before, and another subject. */
function wrongValues(question: PlanQuestion): readonly string[] {
  const parent = question.subject.slice(0, question.subject.lastIndexOf('.') + 1);
  const hadBefore = [
    ['Shop.legacy', 'age'],
    ['.Legacy', 'Shop'],
    ['Status.ARCHIVED', 'OPEN'],
    ['GeoPoint.note', 'lat'],
  ].flatMap(([suffix, name]) =>
    question.subject.endsWith(suffix ?? '') ? [`${question.subject}:${parent}${name}`] : [],
  );
  return [
    'nope',
    `${question.subject}:${parent}nope`,
    ...hadBefore,
    `${question.subject}x:${parent}nope`,
    'billing:nope',
  ];
}

/** The CLI's own reasons for refusing a flag or a typed answer that does not fit, each with the value refused. */
function rejections(
  question: PlanQuestion,
): readonly { readonly verb: PlanQuestionVerb; readonly text: string; readonly reason: string }[] {
  return question.verbs.flatMap((verb) =>
    wrongValues(question).flatMap((text) => {
      const reason = question.validate(verb, text);
      return reason === undefined ? [] : [{ verb, text, reason }];
    }),
  );
}

/**
 * What the engine shows when a typed answer does not fit, and the `CLI.PROMPT_INVALID` the CLI
 * rebuilds from it: the question text and the reason as the engine is given them, then the
 * rebuilt summary and `why`.
 */
async function rebuiltPromptInvalid(
  question: PlanQuestion,
  verb: PlanQuestionVerb,
  text: string,
): Promise<{ readonly shown: readonly string[]; readonly rebuilt: readonly string[] }> {
  const statements: StatementSurface = { take: () => [], values: () => [] };
  const shown: string[] = [];
  const prompt = {
    statements: async (
      asked: readonly {
        readonly question: string;
        readonly validate: (verb: string, text: string) => string | undefined;
      }[],
    ) => {
      const reason = asked[0]?.validate(verb, text) ?? '';
      shown.push(asked[0]?.question ?? '', reason);
      throw new CliStructuredError(
        'CLI.PROMPT_INVALID',
        `"${verb} ${text}" is not valid: ${reason}`,
      );
    },
  } as unknown as PromptSurface;
  const error = await promptPlanQuestions(
    prompt,
    statements,
  )([question]).catch((thrown: unknown) => thrown);
  if (!CliStructuredError.is(error)) throw new Error('Expected the rebuilt CLI.PROMPT_INVALID');
  return { shown, rebuilt: [error.message, error.why ?? ''] };
}

/** The errors a `--rename` flag to a name the contract does not have gets, for each kind of subject. */
function missingNameFlagErrors(): readonly string[] {
  return [
    ['Shop.legacy:Shop.nope', undefined],
    ['Shop.legacy:Shop.nope', 'next'],
    ['Shop.legacy:Shop.age', undefined],
    ['Legacy:Nope', undefined],
    ['Story:Nope', undefined],
    ['Status.ARCHIVED:Status.NOPE', undefined],
    ['Status.ARCHIVED:Status.OPEN', undefined],
    ['GeoPoint.note:GeoPoint.nope', undefined],
    ['GeoPoint.note:GeoPoint.lat', undefined],
    ['billing:nope', 'next'],
  ].flatMap(([text = '', destinationRef]) => {
    const resolved = resolveStatements({
      statements: [{ verb: 'rename', text }],
      origin: { kind: 'contract', contract: origin },
      destination,
      ...(destinationRef === undefined ? {} : { destinationRef }),
    });
    if (resolved.ok) throw new Error(`Expected --rename ${text} to fail`);
    const { message, why, nextActions } = resolved.failure;
    return [message, why ?? '', ...(nextActions ?? []).map(({ label }) => label)];
  });
}

/** The CLI's own errors for `--delete` and `--allow` flags that did nothing. */
function flagsThatDidNothing(): readonly string[] {
  const subject = (text: string) => ({
    kind: 'subject' as const,
    subject: text,
    flag: { verb: 'allow', text },
  });
  return [
    errorConsentUnused(
      [
        { verb: 'delete', text: 'Nope', alreadyAnsweredBy: undefined },
        { verb: 'allow', text: 'Nope', alreadyAnsweredBy: undefined },
        {
          verb: 'delete',
          text: 'billing',
          alreadyAnsweredBy: { kind: 'namespace', namespace: 'billing' },
        },
        { verb: 'allow', text: 'User', alreadyAnsweredBy: subject('User') },
        { verb: 'allow', text: 'Task', alreadyAnsweredBy: subject('Task') },
        { verb: 'allow', text: 'Task', alreadyAnsweredBy: subject('Task') },
      ],
      ['User', 'Task'],
    ),
    errorConsentMisdirected(
      [
        {
          verb: 'allow',
          text: 'Bug',
          line: 'Remove --allow Bug: this change does not change access to model "Bug".',
        },
      ],
      ['Bug'],
    ),
  ].flatMap(({ message, why, nextActions }) => [
    message,
    why ?? '',
    ...(nextActions ?? []).map(({ label }) => label),
  ]);
}

const TOOL_WORDS =
  /statement|question|\banswer|\basks? about|needs \d+ answers|origin contract|destination contract|\bresolve/i;

describe('the texts built when a plan stops to ask', () => {
  it('never use the words of the tool, alone or beside other questions, with flags that did nothing and --yes', async () => {
    const runs = await Promise.all([
      everyKindOfQuestion(true, true, migrationPlanKeepDataEditAdvice(PROJECT)),
      everyKindOfQuestion(false, false, dbUpdateKeepDataEditAdvice(PROJECT, 'sha256:0123')),
      everyKindOfQuestion(true, false, dbUpdateKeepDataEditAdvice(PROJECT, undefined)),
    ]);
    const flags = {
      unmatched: [{ verb: 'delete', values: ['nope'] }],
      misdirected: [{ verb: 'allow', text: 'Legacy', subjectInList: 'model "Legacy"' }],
      confirm: ['postgres'],
      yes: true,
    };
    const refused = runs.flatMap((questions) =>
      questions.flatMap((question) => rejections(question).map((each) => ({ question, ...each }))),
    );
    const prompted = await Promise.all(
      refused.map(({ question, verb, text }) => rebuiltPromptInvalid(question, verb, text)),
    );
    const refusalTexts = runs.flatMap((questions) =>
      [questions, ...questions.map((question) => [question])].flatMap((open) => {
        const refusal = refusalText(open, flags);
        return [refusal.summary, refusal.why ?? '', ...refusal.nextActions];
      }),
    );
    const texts = [
      ...runs.flatMap((questions) =>
        questions.map((each) => questionText(each, { withNamespace: true })),
      ),
      ...refused.map(({ reason }) => reason),
      ...prompted.flatMap(({ shown, rebuilt }) => [...shown, ...rebuilt]),
      ...missingNameFlagErrors(),
      ...flagsThatDidNothing(),
    ];
    const joined = [...texts, ...refusalTexts].join('\n');

    expect({
      questions: runs.map((questions) => questions.length),
      reachesEveryBuilder: [
        'If model "app.Profile" was renamed to "app.Person"',
        'still needs a value: add --backfill',
        'gets no temporary value: plan the change with',
        'the existing objects get a temporary value',
        'To keep that data, run this command with --delete app.Status.DONE',
        'db update cannot keep that data in one run',
        'To keep it with db update, change it in two runs',
        'store a snapshot of the contract before this change',
        'Target advice on keeping it.',
        'The contract no longer has namespace "billing".',
        'give it as --delete',
        'rename needs the new name',
        'the contract has no field "app.Shop.nope" to rename "app.Shop.legacy" to. The contract adds field "app.Shop.rating".',
        'the contract had field "app.Shop.age" before this change too',
        'the contract has no namespace "nope" to rename "billing" to.',
        'To rename "app.Shop.legacy", type rename',
        '"rename app.Shop.legacy:app.Shop.nope" does not fit this change',
        'add field "app.Shop.nope" to the contract, run `prisma contract emit`, and run this command again.',
        'stop this command, add it to the contract, run `prisma contract emit`, and run this command again; delete',
        '"delete nope" does not fit this change: give it as --delete',
        'The contract has no enum value "Status.NOPE" to rename "Status.ARCHIVED" to.',
        'The contract has no value object field "GeoPoint.nope" to rename "GeoPoint.note" to.',
        'add it to the contract under its new name and run `{bin} contract emit`',
        'For field "app.Shop.legacy": target advice on keeping it.',
        'If "audit" or "audit_age" was renamed, keep its data',
        '--yes does not allow this: it would delete data, can change or lose data and would change who can read and write data.',
        'This change would lose data and change access:',
        'Remove --allow Legacy: this change does not change access to model "Legacy".',
        'Access to the data of "app.Shop" would widen.',
        'The contract that --to next names has no field "Shop.nope"',
        'and run this command again without --to next, so that it plans to the emitted contract and not to the one that --to next names.',
        'use --rename Shop.legacy:Shop.rating in place of --rename Shop.legacy:Shop.nope',
        'The contract had field "Shop.age" before this change too, so one change cannot make it the new name of "Shop.legacy".',
        'The contract had enum value "Status.OPEN" before this change too',
        'The contract had value object field "GeoPoint.lat" before this change too',
        'do it in two steps. First, in the contract, give',
        'stop this command and do it in two steps',
        'as a variant of model',
        'this change does not delete the data of anything called that.',
        'stop this command and run it again with --rename',
        'stop this command and keep its data: store a snapshot',
        '--delete Nope names nothing whose data this change deletes.',
        '--allow Nope names nothing whose access this change changes.',
        '--delete billing does nothing: the other --delete flags already cover everything in namespace "billing".',
        '--allow User is given twice, and one is enough.',
        'Remove one --allow User.',
        '--allow Task is given 3 times, and one is enough.',
        'Remove all but one --allow Task.',
        '--allow Bug does nothing in this change.',
      ].filter((text) => !joined.includes(text)),
      toolWords: [...texts, ...refusalTexts].filter((text) => TOOL_WORDS.test(text)),
      promptsWithoutTheBinary: prompted
        .flatMap(({ shown }) => shown)
        .filter((text) => text.includes('{bin}')),
      refusalsNamingTheBinary: refusalTexts.filter((text) => /\bprisma /.test(text)),
    }).toEqual({
      questions: [12, 12, 12],
      reachesEveryBuilder: [],
      toolWords: [],
      promptsWithoutTheBinary: [],
      refusalsNamingTheBinary: [],
    });
  });
});
