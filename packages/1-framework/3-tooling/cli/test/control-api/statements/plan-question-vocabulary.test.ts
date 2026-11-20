import { asNamespaceId } from '@internal/contract/types';
import type { MigrationSubject } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { questionText, refusalText } from '../../../src/control-api/statements/plan-question-text';
import type {
  KeepDataEditAdvice,
  PlanQuestion,
} from '../../../src/control-api/statements/plan-questions';
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
      Task: { fields: ['type', 'status'], discriminator: 'type', variants: { bug: 'Bug' } },
      Bug: { base: 'Task' },
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

/** The CLI's own reasons for refusing a flag or a typed answer that names the subject in a form it does not take. */
function rejections(question: PlanQuestion): readonly string[] {
  return question.verbs.flatMap((verb) => {
    const reason = question.validate(verb, 'nope');
    return reason === undefined ? [] : [reason];
  });
}

const TOOL_WORDS = /statement|question|\banswer|\basks? about|needs \d+ answers/i;

describe('the texts built when a plan stops to ask', () => {
  it('never use the words of the tool, alone or beside other questions, with flags that did nothing and --yes', async () => {
    const runs = await Promise.all([
      everyKindOfQuestion(true, true, migrationPlanKeepDataEditAdvice(PROJECT)),
      everyKindOfQuestion(false, false, dbUpdateKeepDataEditAdvice(PROJECT, 'sha256:0123')),
      everyKindOfQuestion(true, false, dbUpdateKeepDataEditAdvice(PROJECT, undefined)),
    ]);
    const flags = {
      unmatched: [{ verb: 'delete', values: ['nope'] }],
      confirm: ['postgres'],
      yes: true,
    };
    const texts = runs.flatMap((questions) => [
      ...questions.map((each) => questionText(each, true)),
      ...questions.flatMap(rejections),
      ...[questions, ...questions.map((question) => [question])].flatMap((open) => {
        const refusal = refusalText(open, flags);
        return [refusal.summary, refusal.why ?? '', ...refusal.nextActions];
      }),
    ]);
    const joined = texts.join('\n');

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
      ].filter((text) => !joined.includes(text)),
      toolWords: texts.filter((text) => TOOL_WORDS.test(text)),
    }).toEqual({ questions: [12, 12, 12], reachesEveryBuilder: [], toolWords: [] });
  });
});
