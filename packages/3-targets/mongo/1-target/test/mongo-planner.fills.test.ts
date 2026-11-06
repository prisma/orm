import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';
import {
  contract,
  type FieldTypeSpec,
  NS,
  plan,
  refusal,
  schemaCollection,
  settledOperations,
} from './mongo-statement-fixtures';

const OBJECT_ID: FieldTypeSpec = { codecId: 'mongo/objectId@1' };
const STRING: FieldTypeSpec = { codecId: 'mongo/string@1' };

function users(
  seed: string,
  fields: Record<string, FieldTypeSpec>,
  unique: readonly string[] = [],
) {
  return contract(
    seed,
    {
      User: {
        collection: 'users',
        fields: ['_id', 'email', ...Object.keys(fields)],
        types: { _id: OBJECT_ID, email: STRING, ...fields },
      },
    },
    { users: { unique: [...unique] } },
  );
}

const origin = users('from', {});
const live = [schemaCollection('users')];

/** Each fill the plan writes: its label and the value it sets. */
function fills(result: ReturnType<typeof plan>) {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  return settledOperations(result.plan as PlannerProducedMongoMigration).flatMap((operation) => {
    if (!('run' in operation) || !operation.id.includes('.fill')) return [];
    const update: unknown = operation.run[0]?.command;
    const stages: unknown = Reflect.get(update ?? {}, 'update');
    const set: unknown = Array.isArray(stages) ? Reflect.get(stages[0] ?? {}, '$set') : undefined;
    return [{ label: operation.label, set }];
  });
}

describe('MongoMigrationPlanner, a new required field on a collection with documents', () => {
  it('fills each with the temporary value of its type, typed as the field', () => {
    const types: Record<string, FieldTypeSpec> = {
      name: { codecId: 'mongo/string@1' },
      count: { codecId: 'mongo/int32@1' },
      big: { codecId: 'mongo/int64@1' },
      ratio: { codecId: 'mongo/double@1' },
      price: { codecId: 'mongo/decimal128@1' },
      active: { codecId: 'mongo/bool@1' },
      tags: { codecId: 'mongo/string@1', many: true },
    };

    expect(fills(plan({ from: origin, to: users('to', types), schema: live }))).toEqual([
      {
        label: 'Fill field active in collection users where it is missing or null',
        set: { active: false },
      },
      {
        label: 'Fill field big in collection users where it is missing or null',
        set: { big: { $toLong: 0 } },
      },
      {
        label: 'Fill field count in collection users where it is missing or null',
        set: { count: 0 },
      },
      {
        label: 'Fill field name in collection users where it is missing or null',
        set: { name: { $literal: '' } },
      },
      {
        label: 'Fill field price in collection users where it is missing or null',
        set: { price: { $toDecimal: '0' } },
      },
      {
        label: 'Fill field ratio in collection users where it is missing or null',
        set: { ratio: { $toDouble: 0 } },
      },
      {
        label: 'Fill field tags in collection users where it is missing or null',
        set: { tags: [] },
      },
    ]);
  });

  it('reports each fill as a temporary value of the field', () => {
    const result = plan({
      from: origin,
      to: users('to', { big: { codecId: 'mongo/int64@1' } }),
      schema: live,
    });

    expect(result.kind === 'success' ? result.temporaryValues : result).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'field', namespaceId: NS, model: 'User', field: 'big' },
        value: '0',
      },
    ]);
  });

  it('fills nothing for a type with no temporary value, an optional field made required, or a field --backfill names', () => {
    const backfill: ResolvedMigrationStatement = {
      kind: 'backfill',
      entity: 'field',
      field: { namespaceId: NS, model: 'User', field: 'plan' },
    };

    expect([
      fills(
        plan({ from: origin, to: users('to', { at: { codecId: 'mongo/date@1' } }), schema: live }),
      ),
      fills(
        plan({
          from: users('from', { plan: { codecId: 'mongo/string@1', nullable: true } }),
          to: users('to', { plan: STRING }),
          schema: live,
        }),
      ),
    ]).toEqual([[], []]);
    const backfilled = plan({
      from: origin,
      to: users('to', { plan: STRING }),
      schema: live,
      statements: [backfill],
    });
    expect(backfilled.kind === 'success' ? backfilled.temporaryValues : backfilled).toEqual([]);
  });

  it("fills a variant's new field in that variant's documents only", () => {
    const tasks = (seed: string, bugFields: readonly string[]) =>
      contract(
        seed,
        {
          Task: {
            collection: 'tasks',
            fields: ['_id', 'type'],
            types: { _id: OBJECT_ID },
            discriminator: 'type',
            variants: { Bug: 'bug' },
          },
          Bug: { collection: 'tasks', fields: [...bugFields], base: 'Task' },
        },
        { tasks: {} },
      );

    expect(
      fills(
        plan({
          from: tasks('from', []),
          to: tasks('to', ['severity']),
          schema: [schemaCollection('tasks')],
        }),
      ),
    ).toEqual([
      {
        label:
          'Fill field severity in collection tasks where it is missing or null in documents whose type is "bug"',
        set: { severity: { $literal: '' } },
      },
    ]);
  });

  it('refuses a new required field under a unique index, naming --backfill', () => {
    expect(
      refusal(plan({ from: origin, to: users('to', { code: STRING }, ['code']), schema: live })),
    ).toEqual([
      {
        kind: 'fieldFillRefused',
        summary:
          'Cannot fill new required field "User.code" in collection "users" with a temporary value: a unique index covers it',
        why: 'Every document would get the same value, which the unique index refuses. Plan the change with migration plan and --backfill User.code, and write a value for each document in migration.ts.',
      },
    ]);
  });

  it('refuses a fill in a time-series collection, and in a collection another root model shares', () => {
    const shared = (seed: string, userFields: readonly string[]) =>
      contract(
        seed,
        {
          User: { collection: 'people', fields: ['_id', ...userFields], types: { _id: OBJECT_ID } },
          Admin: { collection: 'people', fields: ['_id'], types: { _id: OBJECT_ID } },
        },
        { people: {} },
      );
    const readings = (seed: string, fields: readonly string[]) =>
      contract(
        seed,
        {
          Reading: {
            collection: 'readings',
            fields: ['_id', 'at', ...fields],
            types: { _id: OBJECT_ID },
          },
        },
        { readings: { timeField: 'at' } },
      );

    expect([
      refusal(
        plan({
          from: shared('from', []),
          to: shared('to', ['plan']),
          schema: [schemaCollection('people')],
        }),
      ).map(({ summary }) => summary),
      refusal(
        plan({
          from: readings('from', []),
          to: readings('to', ['note']),
          schema: [schemaCollection('readings', { timeseries: true })],
        }),
      ).map(({ summary }) => summary),
    ]).toEqual([
      [
        'Cannot fill field "plan" of model "User" in collection "people": model "Admin" is stored in the same collection',
      ],
      ['Cannot fill field "note" in collection "readings": it is a time-series collection'],
    ]);
  });

  describe('beside renames', () => {
    const renamedModel = (seed: string, model: string, fields: readonly string[]) =>
      contract(
        seed,
        { [model]: { collection: 'users', fields: ['_id', ...fields], types: { _id: OBJECT_ID } } },
        { users: {} },
      );

    it('fills no field a rename gives its new name', () => {
      expect(
        fills(
          plan({
            from: users('from', { nickname: STRING }),
            to: users('to', { plan: STRING }),
            schema: live,
            statements: [
              {
                kind: 'rename',
                entity: 'field',
                from: { namespaceId: NS, model: 'User', field: 'nickname' },
                to: { namespaceId: NS, model: 'User', field: 'plan' },
              },
            ],
          }),
        ),
      ).toEqual([]);
    });

    it("fills none of a renamed model's fields, and only the field that is new beside the rename", () => {
      const renameModel: ResolvedMigrationStatement = {
        kind: 'rename',
        entity: 'model',
        from: { namespaceId: NS, model: 'Profile' },
        to: { namespaceId: NS, model: 'User' },
      };

      expect([
        fills(
          plan({
            from: renamedModel('from', 'Profile', ['name']),
            to: renamedModel('to', 'User', ['name']),
            schema: live,
            statements: [renameModel],
          }),
        ),
        fills(
          plan({
            from: renamedModel('from', 'Profile', ['name']),
            to: renamedModel('to', 'User', ['name', 'plan']),
            schema: live,
            statements: [renameModel],
          }),
        ).map(({ label }) => label),
      ]).toEqual([[], ['Fill field plan in collection users where it is missing or null']]);
    });
  });

  it("refuses a variant's fill whose discriminator value another root model's variant also has", () => {
    const models = (superFields: readonly string[]) =>
      contract(
        `seed-${superFields.join(',')}`,
        {
          Admin: {
            collection: 'users',
            fields: ['_id', 'kind'],
            types: { _id: OBJECT_ID },
            discriminator: 'kind',
            variants: { SuperAdmin: 'super' },
          },
          SuperAdmin: { collection: 'users', fields: [...superFields], base: 'Admin' },
          Member: {
            collection: 'users',
            fields: ['_id', 'kind'],
            types: { _id: OBJECT_ID },
            discriminator: 'kind',
            variants: { SuperMember: 'super' },
          },
          SuperMember: { collection: 'users', fields: [], base: 'Member' },
        },
        { users: {} },
      );

    expect(
      refusal(plan({ from: models([]), to: models(['level']), schema: live })).map(
        ({ summary }) => summary,
      ),
    ).toEqual([
      'Cannot fill field "level" of model "SuperAdmin" in collection "users": model "Member", "SuperMember" is stored in the same collection',
    ]);
  });
});
