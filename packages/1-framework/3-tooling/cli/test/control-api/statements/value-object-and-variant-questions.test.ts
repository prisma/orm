import { asNamespaceId, type ContractWithDomain } from '@internal/contract/types';
import type { MigrationSubject } from '@internal/framework-components/control';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import {
  askPlanQuestions,
  consentDescription,
  type PlanQuestion,
} from '../../../src/control-api/statements/plan-questions';
import { contractOf } from './statement-fixtures';

const app = asNamespaceId('app');

async function questionsOf(input: {
  readonly origin: ContractWithDomain;
  readonly destination: ContractWithDomain;
  readonly subject: MigrationSubject;
  readonly labels?: readonly string[];
  readonly keepDataAdvice?: string;
  readonly canConvert?: boolean;
  readonly preAnswers?: readonly { readonly verb: 'delete'; readonly text: string }[];
}) {
  const asked: PlanQuestion[] = [];
  const result = await askPlanQuestions({
    plan: {
      dataLoss: (input.labels ?? ['Remove key']).map((label, operationIndex) => ({
        operationIndex,
        label,
        loss: 'drop',
        subject: input.subject,
        ...(input.keepDataAdvice === undefined ? {} : { keepDataAdvice: input.keepDataAdvice }),
      })),
      accessChanges: [],
    },
    askAccess: false,
    canConvert: input.canConvert ?? false,
    statements: [],
    preAnswers: input.preAnswers ?? [],
    consentAll: { delete: false, allow: false },
    origin: input.origin,
    originKnown: true,
    destination: input.destination,
    answer: async (batch) => {
      asked.push(...batch);
      return batch.map(({ subject }) => ({ verb: 'delete', text: subject }));
    },
    replan: async () => ok({ dataLoss: [], accessChanges: [] }),
  });
  return { asked, consented: result.ok ? result.value.consented : undefined };
}

describe('a question about a value object field', () => {
  const place = {
    fields: ['id', 'location'],
    fieldTypes: { location: { valueObject: 'GeoPoint' } },
  };
  const origin = contractOf({
    app: { models: { Place: place }, valueObjects: { GeoPoint: ['lat', 'lng'] } },
  });
  const destination = contractOf({
    app: { models: { Place: place }, valueObjects: { GeoPoint: ['latitude', 'lng'] } },
  });
  const lat = {
    kind: 'valueObjectField',
    namespaceId: app,
    valueObject: 'GeoPoint',
    field: 'lat',
  } as const;

  it('says what --delete leaves in the one new required field, as each command fills it', async () => {
    const asked = await Promise.all(
      [true, false].map(async (canConvert) => {
        const {
          asked: [question],
        } = await questionsOf({ origin, destination, subject: lat, canConvert });
        return question?.question;
      }),
    );

    expect(asked).toEqual([
      'Remove key would lose the values of value object field "GeoPoint.lat". With --delete GeoPoint.lat, the new required field "GeoPoint.latitude" still needs a value: add --backfill GeoPoint.latitude to write it in migration.ts.',
      'Remove key would lose the values of value object field "GeoPoint.lat". With --delete GeoPoint.lat, the existing objects get a temporary value in the new required field "GeoPoint.latitude".',
    ]);
  });

  it('names the field through its value object, lists every operation, and offers the one new field as the rename', async () => {
    const {
      asked: [question],
    } = await questionsOf({
      origin,
      destination,
      subject: lat,
      labels: ['Remove key "lat" from "place"."location"', 'Remove key "lat" from "trip"."stops"'],
    });

    expect(question).toMatchObject({
      subject: 'GeoPoint.lat',
      question:
        'These operations would lose the values of value object field "GeoPoint.lat":\n- Remove key "lat" from "place"."location"\n- Remove key "lat" from "trip"."stops"\nWith --delete GeoPoint.lat, the existing objects get a temporary value in the new required field "GeoPoint.latitude".',
      verbs: ['rename', 'delete'],
      forms: { rename: 'GeoPoint.lat:GeoPoint.latitude' },
    });
    expect(question?.validate('rename', 'GeoPoint.lat:GeoPoint.latitude')).toBeUndefined();
    expect(question?.validate('rename', 'GeoPoint.lng:GeoPoint.latitude')).toBeDefined();
    expect(consentDescription('delete', lat, 'GeoPoint.lat', 'drop')).toBe(
      'delete value object field "GeoPoint.lat"',
    );
  });

  it('asks one question for a removed field, listing the operation on every column', async () => {
    const removed = contractOf({
      app: { models: { Place: place }, valueObjects: { GeoPoint: ['lat'] } },
    });
    const lng = { ...lat, field: 'lng' };
    const { asked } = await questionsOf({
      origin,
      destination: removed,
      subject: lng,
      labels: [
        'Remove key "lng" at path "$" in column "location" of "place"',
        'Remove key "lng" at path "$[*]" in column "stops" of "trip"',
      ],
    });
    expect(asked).toMatchObject([
      {
        subject: 'GeoPoint.lng',
        question:
          'These operations would lose the values of value object field "GeoPoint.lng":\n- Remove key "lng" at path "$" in column "location" of "place"\n- Remove key "lng" at path "$[*]" in column "stops" of "trip"',
        verbs: ['rename', 'delete'],
      },
    ]);
  });

  it('takes --delete GeoPoint.lng as the answer, so it asks nothing', async () => {
    const removed = contractOf({
      app: { models: { Place: place }, valueObjects: { GeoPoint: ['lat'] } },
    });
    const lng = { ...lat, field: 'lng' };
    expect(
      await questionsOf({
        origin,
        destination: removed,
        subject: lng,
        preAnswers: [{ verb: 'delete', text: 'GeoPoint.lng' }],
      }),
    ).toEqual({
      asked: [],
      consented: [
        { verb: 'delete', subject: lng, text: 'GeoPoint.lng', operationIndex: 0, loss: 'drop' },
      ],
    });
  });

  it('offers only delete for a field the destination value object still has', async () => {
    const {
      asked: [question],
    } = await questionsOf({
      origin,
      destination: origin,
      subject: { ...lat, field: 'lng' },
    });
    expect(question?.verbs).toEqual(['delete']);
  });
});

describe('a question about a variant whose discriminator value changed', () => {
  function tasks(values: Readonly<Record<string, string>>) {
    return contractOf({
      app: {
        models: {
          Task: { fields: ['id', 'type'], discriminator: 'type', variants: values },
          Bug: { base: 'Task' },
          Epic: { base: 'Task' },
        },
      },
    });
  }
  const bug = { kind: 'model', namespaceId: app, model: 'Bug' } as const;

  it('offers --convert first, then --delete, also where the command writes no migration file', async () => {
    const {
      asked: [question],
    } = await questionsOf({
      origin: tasks({ bug: 'Bug', epic: 'Epic' }),
      destination: tasks({ defect: 'Bug', epic: 'Epic' }),
      subject: bug,
      labels: ['Delete rows of "task" whose "type" is "bug"'],
    });

    expect(question).toMatchObject({
      subject: 'Bug',
      verbs: ['convert', 'delete'],
      forms: { convert: 'Bug' },
    });
    expect(question?.validate('convert', 'Bug')).toBeUndefined();
    expect(question?.validate('convert', 'Epic')).toContain('--convert Bug');
  });

  it('offers only delete for a variant whose value did not change', async () => {
    const contract = tasks({ bug: 'Bug', epic: 'Epic' });
    const {
      asked: [question],
    } = await questionsOf({ origin: contract, destination: contract, subject: bug });
    expect(question?.verbs).toEqual(['delete']);
  });
});

describe('a question about a removed variant', () => {
  function tasks(variants: Readonly<Record<string, string>>) {
    return contractOf({
      app: {
        models: {
          Task: { fields: ['id', 'type'], discriminator: 'type', variants },
          ...Object.fromEntries(Object.values(variants).map((model) => [model, { base: 'Task' }])),
        },
      },
    });
  }
  const origin = tasks({ bug: 'Bug', epic: 'Epic' });
  const destination = tasks({ epic: 'Epic' });
  const bug = { kind: 'model', namespaceId: app, model: 'Bug' } as const;
  const labels = [
    'Drop column "severity" of "tasks"',
    'Delete the rows of "tasks" that hold value "bug" in column "type"',
  ];

  it('asks one question about the model for its column drop and its row deletion', async () => {
    const { asked } = await questionsOf({ origin, destination, subject: bug, labels });
    expect(asked).toMatchObject([
      {
        subject: 'Bug',
        question:
          'These operations would lose the data of model "Bug":\n- Drop column "severity" of "tasks"\n- Delete the rows of "tasks" that hold value "bug" in column "type"',
        verbs: ['rename', 'delete'],
      },
    ]);
  });

  it('offers the one new variant of the same base as the rename', async () => {
    const {
      asked: [question],
    } = await questionsOf({
      origin,
      destination: tasks({ epic: 'Epic', issue: 'Issue' }),
      subject: bug,
      labels,
    });
    expect(question?.forms).toEqual({ rename: 'Bug:Issue' });
  });

  it('says what the target advises about rows other tables reference', async () => {
    const {
      asked: [question],
    } = await questionsOf({
      origin,
      destination,
      subject: bug,
      labels: [labels[1] ?? ''],
      keepDataAdvice: 'SQLite migrations run with foreign keys off.',
    });
    expect(question?.question).toContain('SQLite migrations run with foreign keys off.');
  });

  it('takes --delete Bug as the one answer for the variant', async () => {
    expect(
      await questionsOf({
        origin,
        destination,
        subject: bug,
        labels,
        preAnswers: [{ verb: 'delete', text: 'Bug' }],
      }),
    ).toEqual({
      asked: [],
      consented: [{ verb: 'delete', subject: bug, text: 'Bug', operationIndex: 1, loss: 'drop' }],
    });
  });
});
