import { asNamespaceId, type ContractWithDomain } from '@internal/contract/types';
import type { MigrationSubject } from '@internal/framework-components/control';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import type { QuestionMigrationPlan } from '../../../src/control-api/statements/plan-questions';
import {
  askPlanQuestions,
  consentDescription,
  type PlannedQuestions,
  type PlanQuestion,
} from '../../../src/control-api/statements/plan-questions';
import { NOT_RECORDED, NOT_RECORDED_REASON, reference } from '../../utils/plan-origins';
import { contractOf } from './statement-fixtures';

const app = asNamespaceId('app');

function geoPointField(field: string): MigrationSubject {
  return { kind: 'valueObjectField', namespaceId: app, valueObject: 'GeoPoint', field };
}

function lineField(field: string): MigrationSubject {
  return { kind: 'field', namespaceId: app, model: 'Line', field };
}

async function questionsOf(input: {
  readonly origin: ContractWithDomain;
  readonly destination: ContractWithDomain;
  readonly subject: MigrationSubject;
  readonly labels?: readonly string[];
  readonly keepDataAdvice?: string;
  readonly canConvert?: boolean;
  readonly statements?: readonly { readonly verb: 'backfill'; readonly text: string }[];
  readonly preAnswers?: readonly { readonly verb: 'delete'; readonly text: string }[];
  /** The fields the plan gives a temporary value; none when left out. */
  readonly temporaryValues?: readonly MigrationSubject[];
  readonly migrationPlan?: QuestionMigrationPlan;
}) {
  const asked: PlanQuestion[] = [];
  const result = await askPlanQuestions<PlannedQuestions, never>({
    plan: {
      dataLoss: (input.labels ?? ['Remove key']).map((label, operationIndex) => ({
        operationIndex,
        label,
        loss: 'drop',
        subject: input.subject,
        ...(input.keepDataAdvice === undefined ? {} : { keepDataAdvice: input.keepDataAdvice }),
      })),
      accessChanges: [],
      temporaryValues: (input.temporaryValues ?? []).map((subject, operationIndex) => ({
        operationIndex,
        subject,
        value: '""',
      })),
    },
    askAccess: false,
    canConvert: input.canConvert ?? false,
    statements: input.statements ?? [],
    preAnswers: input.preAnswers ?? [],
    consentAll: { delete: false, allow: false },
    origin: input.origin,
    originKnown: true,
    destination: input.destination,
    answer: async (batch) => {
      asked.push(...batch);
      return batch.map(({ subject }) => ({ verb: 'delete', text: subject }));
    },
    replan: async () => ok({ dataLoss: [], accessChanges: [], temporaryValues: [] }),
    ...(input.migrationPlan === undefined ? {} : { migrationPlan: input.migrationPlan }),
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
        } = await questionsOf({
          origin,
          destination,
          subject: lat,
          canConvert,
          temporaryValues: canConvert ? [] : [geoPointField('latitude')],
        });
        return question?.question;
      }),
    );

    expect(asked).toEqual([
      'Remove key would lose the values of value object field "GeoPoint.lat". If you answer delete, the new required field "GeoPoint.latitude" still needs a value: add --backfill GeoPoint.latitude to write it in migration.ts.',
      'Remove key would lose the values of value object field "GeoPoint.lat". If you answer delete, the existing objects get a temporary value in the new required field "GeoPoint.latitude".',
    ]);
  });

  it('says what --delete leaves in the new required field as the plan fills it, whatever the command', async () => {
    const asked = await Promise.all(
      [
        { canConvert: true, temporaryValues: [geoPointField('latitude')] },
        {
          canConvert: false,
          temporaryValues: [],
          migrationPlan: {
            from: reference('db'),
            to: { kind: 'default' as const },
            invocation: undefined,
          },
        },
        {
          canConvert: false,
          temporaryValues: [],
          migrationPlan: {
            from: NOT_RECORDED,
            to: { kind: 'default' as const },
            invocation: undefined,
          },
        },
      ].map(async ({ canConvert, temporaryValues, migrationPlan }) => {
        const {
          asked: [question],
        } = await questionsOf({
          origin,
          destination,
          subject: lat,
          canConvert,
          temporaryValues,
          ...(migrationPlan === undefined ? {} : { migrationPlan }),
        });
        return question?.question;
      }),
    );

    expect(asked).toEqual([
      'Remove key would lose the values of value object field "GeoPoint.lat". If you answer delete, the existing objects get a temporary value in the new required field "GeoPoint.latitude".',
      'Remove key would lose the values of value object field "GeoPoint.lat". If you answer delete, the new required field "GeoPoint.latitude" gets no temporary value: plan the change with `{bin} migration plan --from db --backfill GeoPoint.latitude` to write its value in migration.ts, run `node <migration directory>/migration.ts` for the directory it writes, and apply it with `{bin} db migrate`.',
      `Remove key would lose the values of value object field "GeoPoint.lat". If you answer delete, the new required field "GeoPoint.latitude" gets no temporary value: no migration can be planned to write its value either. ${NOT_RECORDED_REASON}.`,
    ]);
  });

  it('names the new field as the destination contract does, which the reported temporary values use', async () => {
    const twoNamespaces = contractOf({
      app: { models: { Place: place }, valueObjects: { GeoPoint: ['latitude', 'lng'] } },
      other: { models: { Tag: { fields: ['id'] } } },
    });
    const {
      asked: [question],
    } = await questionsOf({
      origin,
      destination: twoNamespaces,
      subject: lat,
      canConvert: true,
      temporaryValues: [geoPointField('latitude')],
    });

    expect(question?.question).toBe(
      'Remove key would lose the values of value object field "GeoPoint.lat". If you answer delete, the existing objects get a temporary value in the new required field "app.GeoPoint.latitude".',
    );
  });

  it('leaves out the note under migration plan when the run already backfills the new field', async () => {
    const {
      asked: [question],
    } = await questionsOf({
      origin,
      destination,
      subject: lat,
      canConvert: true,
      statements: [{ verb: 'backfill', text: 'GeoPoint.latitude' }],
    });

    expect(question?.question).toBe(
      'Remove key would lose the values of value object field "GeoPoint.lat".',
    );
  });

  describe('when the value object gained several required fields', () => {
    const gained = contractOf({
      app: {
        models: { Place: place },
        valueObjects: { GeoPoint: ['latitude', 'longitude', 'lng'] },
      },
    });

    async function questionText(
      canConvert: boolean,
      statements: readonly { readonly verb: 'backfill'; readonly text: string }[] = [],
    ) {
      const {
        asked: [question],
      } = await questionsOf({
        origin,
        destination: gained,
        subject: lat,
        canConvert,
        statements,
        temporaryValues: canConvert ? [] : [geoPointField('latitude'), geoPointField('longitude')],
      });
      return question?.question;
    }

    it('names every new required field', async () => {
      expect([await questionText(true), await questionText(false)]).toEqual([
        'Remove key would lose the values of value object field "GeoPoint.lat". If you answer delete, the new required fields "GeoPoint.latitude" and "GeoPoint.longitude" still need a value: add --backfill GeoPoint.latitude --backfill GeoPoint.longitude to write them in migration.ts.',
        'Remove key would lose the values of value object field "GeoPoint.lat". If you answer delete, the existing objects get a temporary value in the new required fields "GeoPoint.latitude" and "GeoPoint.longitude".',
      ]);
    });

    it('names under migration plan only the new required fields the run does not backfill', async () => {
      expect(await questionText(true, [{ verb: 'backfill', text: 'GeoPoint.latitude' }])).toBe(
        'Remove key would lose the values of value object field "GeoPoint.lat". If you answer delete, the new required field "GeoPoint.longitude" still needs a value: add --backfill GeoPoint.longitude to write it in migration.ts.',
      );
    });
  });

  it('names the field through its value object, lists every operation, and offers the one new field as the rename', async () => {
    const {
      asked: [question],
    } = await questionsOf({
      origin,
      destination,
      subject: lat,
      labels: ['Remove key "lat" from "place"."location"', 'Remove key "lat" from "trip"."stops"'],
      temporaryValues: [geoPointField('latitude')],
    });

    expect(question).toMatchObject({
      subject: 'GeoPoint.lat',
      question:
        'These operations would lose the values of value object field "GeoPoint.lat":\n- Remove key "lat" from "place"."location"\n- Remove key "lat" from "trip"."stops"\nIf you answer delete, the existing objects get a temporary value in the new required field "GeoPoint.latitude".',
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
      question:
        'Delete rows of "task" whose "type" is "bug" would lose the data of model "Bug". Its discriminator value changes from "bug" to "defect": --convert Bug rewrites the stored value to "defect" and keeps the data.',
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

describe('a question about a field removed by several operations', () => {
  it('lists every operation that loses its values', async () => {
    const origin = contractOf({ app: { models: { Line: { fields: ['sku', 'note'] } } } });
    const destination = contractOf({ app: { models: { Line: { fields: ['sku'] } } } });
    const { asked } = await questionsOf({
      origin,
      destination,
      subject: { kind: 'field', namespaceId: app, model: 'Line', field: 'note' },
      labels: [
        'Remove key "note" at path "$[*]" in field lines of collection orders',
        'Remove key "note" at path "$[*]" in field pastLines of collection orders',
      ],
    });
    expect(asked.map(({ question }) => question)).toEqual([
      expect.stringContaining(
        '- Remove key "note" at path "$[*]" in field lines of collection orders\n- Remove key "note" at path "$[*]" in field pastLines of collection orders',
      ),
    ]);
  });
});

describe('a question about a field of an embedded model', () => {
  const models = (line: readonly string[]) => ({
    Order: { fields: ['id'] },
    Line: { fields: line, owner: 'Order' },
  });
  const origin = contractOf({ app: { models: models(['sku', 'qty']) } });
  const destination = contractOf({ app: { models: models(['code', 'qty']) } });
  const sku = { kind: 'field', namespaceId: app, model: 'Line', field: 'sku' } as const;

  it('says what delete leaves in the one new required field, as each command fills it', async () => {
    const asked = await Promise.all(
      [
        { canConvert: true, temporaryValues: [] },
        { canConvert: false, temporaryValues: [lineField('code')] },
      ].map(async ({ canConvert, temporaryValues }) => {
        const {
          asked: [question],
        } = await questionsOf({
          origin,
          destination,
          subject: sku,
          labels: ['Remove key'],
          canConvert,
          temporaryValues,
        });
        return question?.question;
      }),
    );

    expect(asked).toEqual([
      'Remove key would lose the values of field "Line.sku". If you answer delete, the new required field "Line.code" still needs a value: add --backfill Line.code to write it in migration.ts.',
      'Remove key would lose the values of field "Line.sku". If you answer delete, the existing objects get a temporary value in the new required field "Line.code".',
    ]);
  });

  it('says nothing for a field of a model no other model embeds', async () => {
    const roots = (fields: readonly string[]) =>
      contractOf({ app: { models: { Line: { fields } } } });
    const {
      asked: [question],
    } = await questionsOf({
      origin: roots(['sku', 'qty']),
      destination: roots(['code', 'qty']),
      subject: sku,
      temporaryValues: [lineField('code')],
    });

    expect(question?.question).toBe('Remove key would lose the values of field "Line.sku".');
  });
});
