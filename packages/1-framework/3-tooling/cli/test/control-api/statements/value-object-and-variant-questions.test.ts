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
  readonly canConvert?: boolean;
}) {
  const asked: PlanQuestion[] = [];
  await askPlanQuestions({
    plan: {
      dataLoss: (input.labels ?? ['Remove key']).map((label, operationIndex) => ({
        operationIndex,
        label,
        loss: 'drop',
        subject: input.subject,
      })),
      accessChanges: [],
    },
    askAccess: false,
    canConvert: input.canConvert ?? false,
    statements: [],
    preAnswers: [],
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
  return asked;
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

  it('names the field through its value object, lists every operation, and offers the one new field as the rename', async () => {
    const [question] = await questionsOf({
      origin,
      destination,
      subject: lat,
      labels: ['Remove key "lat" from "place"."location"', 'Remove key "lat" from "trip"."stops"'],
    });

    expect(question).toMatchObject({
      subject: 'GeoPoint.lat',
      question:
        'Remove key "lat" from "place"."location" and remove key "lat" from "trip"."stops" would lose the values of value object field "GeoPoint.lat".',
      verbs: ['rename', 'delete'],
      forms: { rename: 'GeoPoint.lat:GeoPoint.latitude' },
    });
    expect(question?.validate('rename', 'GeoPoint.lat:GeoPoint.latitude')).toBeUndefined();
    expect(question?.validate('rename', 'GeoPoint.lng:GeoPoint.latitude')).toBeDefined();
    expect(consentDescription('delete', lat, 'GeoPoint.lat', 'drop')).toBe(
      'delete value object field "GeoPoint.lat"',
    );
  });

  it('offers only delete for a field the destination value object still has', async () => {
    const [question] = await questionsOf({
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
    const [question] = await questionsOf({
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
    const [question] = await questionsOf({ origin: contract, destination: contract, subject: bug });
    expect(question?.verbs).toEqual(['delete']);
  });
});
