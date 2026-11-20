import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { refusalText } from '../../../src/control-api/statements/plan-question-text';
import { askedAbout } from './plan-question-fixtures';
import { contractOf } from './statement-fixtures';

const app = asNamespaceId('app');
const billing = asNamespaceId('billing');

async function everyKindOfQuestion() {
  const origin = contractOf({
    app: {
      models: {
        Shop: { fields: ['id', 'legacy', 'age'] },
        Legacy: {},
        Place: { fields: ['location'], fieldTypes: { location: { valueObject: 'GeoPoint' } } },
        Task: { fields: ['type', 'status'], discriminator: 'type', variants: { bug: 'Bug' } },
        Bug: { base: 'Task' },
      },
      enums: { Status: ['OPEN', 'ARCHIVED'] },
      valueObjects: { GeoPoint: ['lat', 'note?'] },
    },
    billing: { models: { Invoice: {} } },
  });
  const destination = contractOf({
    app: {
      models: {
        Shop: { fields: ['id', 'rating', 'age'], fieldTypes: { age: { codecId: 'test/int@1' } } },
        Place: { fields: ['location'], fieldTypes: { location: { valueObject: 'GeoPoint' } } },
        Task: { fields: ['type', 'status'], discriminator: 'type', variants: { defect: 'Bug' } },
        Bug: { base: 'Task' },
      },
      enums: { Status: ['OPEN'] },
      valueObjects: { GeoPoint: ['lat'] },
    },
    finance: { models: { Invoice: {} } },
  });
  return Promise.all(
    [true, false].map((originKnown) =>
      askedAbout({
        origin,
        destination,
        originKnown,
        losses: [
          { label: 'Drop "legacy"', subject: { kind: 'model', namespaceId: app, model: 'Legacy' } },
          {
            label: 'Drop "shop"."legacy"',
            subject: { kind: 'field', namespaceId: app, model: 'Shop', field: 'legacy' },
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
            label: 'Remove key "note"',
            subject: {
              kind: 'valueObjectField',
              namespaceId: app,
              valueObject: 'GeoPoint',
              field: 'note',
            },
          },
          { label: 'Rewrite "bug"', subject: { kind: 'model', namespaceId: app, model: 'Bug' } },
          {
            label: 'Drop "invoice"',
            subject: { kind: 'model', namespaceId: billing, model: 'Invoice' },
          },
          { label: 'Drop "audit"', subject: { kind: 'storage', name: 'audit' } },
        ],
        accessChanges: [
          {
            label: 'Disable row-level security on "shop"',
            subject: { kind: 'model', namespaceId: app, model: 'Shop' },
            widens: true,
          },
        ],
        namespaces: { removed: ['billing'], added: ['finance'] },
      }),
    ),
  );
}

describe('the texts built when a plan stops to ask', () => {
  it('never say "statement" or "question", alone or with flags that answered nothing and --yes', async () => {
    const runs = await everyKindOfQuestion();
    const flags = {
      unmatched: [{ verb: 'delete', values: ['nope'] }],
      confirm: ['postgres'],
      yes: true,
    };
    const texts = runs.flatMap((questions) => [
      ...questions.map(({ question }) => question),
      ...[questions, ...questions.map((question) => [question])].flatMap((open) => {
        const refusal = refusalText(open, flags);
        return [refusal.summary, refusal.why ?? '', ...refusal.nextActions];
      }),
    ]);

    expect(runs.map((questions) => questions.length)).toEqual([9, 9]);
    expect(texts.filter((text) => /statement|question/i.test(text))).toEqual([]);
  });
});
