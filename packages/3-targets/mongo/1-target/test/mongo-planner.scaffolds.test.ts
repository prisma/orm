import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';
import {
  contract,
  type FieldTypeSpec,
  listedOperations,
  NS,
  plan,
  refusal,
  schemaCollection,
} from './mongo-statement-fixtures';

const OBJECT_ID: FieldTypeSpec = { codecId: 'mongo/objectId@1' };
const INT: FieldTypeSpec = { codecId: 'mongo/int32@1' };
const STRING: FieldTypeSpec = { codecId: 'mongo/string@1' };
const OPTIONAL_STRING: FieldTypeSpec = { codecId: 'mongo/string@1', nullable: true };

const BSON_TYPE: Readonly<Record<string, string>> = {
  'mongo/int32@1': 'int',
  'mongo/string@1': 'string',
};

function propertyOf(type: FieldTypeSpec): Record<string, unknown> {
  const bsonType = BSON_TYPE[type.codecId] ?? 'string';
  return { bsonType: type.nullable === true ? ['null', bsonType] : bsonType };
}

function closedSchema(fields: Record<string, FieldTypeSpec>) {
  return {
    bsonType: 'object',
    required: [
      '_id',
      ...Object.entries(fields)
        .filter(([, type]) => type.nullable !== true)
        .map(([field]) => field),
    ],
    properties: {
      _id: { bsonType: 'objectId' },
      ...Object.fromEntries(
        Object.entries(fields).map(([field, type]) => [field, propertyOf(type)]),
      ),
    },
    additionalProperties: false,
  };
}

function users(seed: string, fields: Record<string, FieldTypeSpec>) {
  return contract(
    seed,
    {
      User: {
        collection: 'users',
        fields: ['_id', ...Object.keys(fields)],
        types: { _id: OBJECT_ID, ...fields },
      },
    },
    { users: { jsonSchema: closedSchema(fields) } },
  );
}

function liveUsers(fields: Record<string, FieldTypeSpec>) {
  return schemaCollection('users', { jsonSchema: closedSchema(fields) });
}

function fieldStatement(kind: 'convert' | 'backfill', field: string): ResolvedMigrationStatement {
  return { kind, entity: 'field', field: { namespaceId: NS, model: 'User', field } };
}

async function scaffolded(result: ReturnType<typeof plan>) {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  const migration = result.plan as PlannerProducedMongoMigration;
  return {
    operations: (await listedOperations(migration)).map((operation) =>
      Reflect.get(operation ?? {}, 'label'),
    ),
    applied: result.appliedStatements.map((applied) => applied.operationIndexes),
    dataLoss: result.dataLoss,
  };
}

function migrationTs(result: ReturnType<typeof plan>): string {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  return compact(
    (result.plan as PlannerProducedMongoMigration).renderTypeScript((specifier) => specifier),
  );
}

/** Source without whitespace, since the CLI formats the migration.ts it writes. */
function compact(source: string): string {
  return source.replace(/\s+/g, '').replace(/,(?=[\]}])/g, '');
}

describe('MongoMigrationPlanner, --convert of a field whose type changes', () => {
  const converted = () =>
    plan({
      from: users('from', { age: STRING }),
      to: users('to', { age: INT }),
      schema: [liveUsers({ age: STRING })],
      statements: [fieldStatement('convert', 'age')],
    });

  it('writes a data transform in place of the cast, before the validator change, and asks nothing', async () => {
    expect(await scaffolded(converted())).toEqual({
      operations: ['Data transform: User.age', 'Update validator on users (changed: age)'],
      applied: [[0]],
      dataLoss: [],
    });
  });

  it('filters the documents whose field holds a type the new field does not allow', () => {
    expect(migrationTs(converted())).toContain(
      compact(
        [
          'dataTransform("User.age", {',
          '  check: { source: () => rawAggregate("users", [{ $match: { $expr: { $not: { $in: [{ $type: "$age" }, ["missing", "null", "int"]] } } } }, { $limit: 1 }]) },',
          '  run: () => rawUpdateMany("users", { $expr: { $not: { $in: [{ $type: "$age" }, ["missing", "null", "int"]] } } }, placeholder("User.age:update"), { bypassDocumentValidation: true }),',
          '})',
        ].join('\n'),
      ),
    );
  });

  it("filters a variant's field on its discriminator value too", () => {
    const tasks = (seed: string, severity: FieldTypeSpec) =>
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
          Bug: { collection: 'tasks', fields: ['severity'], types: { severity }, base: 'Task' },
        },
        { tasks: {} },
      );

    expect(
      migrationTs(
        plan({
          from: tasks('from', STRING),
          to: tasks('to', INT),
          schema: [schemaCollection('tasks')],
          statements: [
            {
              kind: 'convert',
              entity: 'field',
              field: { namespaceId: NS, model: 'Bug', field: 'severity' },
            },
          ],
        }),
      ),
    ).toContain(
      compact(
        'rawAggregate("tasks", [{ $match: { $and: [{ type: "bug" }, { $expr: { $not: { $in: [{ $type: "$severity" }, ["missing", "null", "int"]] } } }] } }, { $limit: 1 }])',
      ),
    );
  });

  it('refuses a convert of a field whose type does not change', () => {
    expect(
      refusal(
        plan({
          from: users('from', { age: INT }),
          to: users('to', { age: INT }),
          schema: [liveUsers({ age: INT })],
          statements: [fieldStatement('convert', 'age')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary: 'Cannot convert field "User.age": its type does not change',
        why: 'Leave out this statement.',
      },
    ]);
  });
});

describe('MongoMigrationPlanner, --backfill of a required field', () => {
  it('fills a new required field where it is missing or null, after the casts and before the removals', async () => {
    const result = plan({
      from: users('from', { age: STRING, nickname: STRING }),
      to: users('to', { age: INT, plan: STRING }),
      schema: [liveUsers({ age: STRING, nickname: STRING })],
      statements: [fieldStatement('backfill', 'plan')],
    });

    expect(await scaffolded(result)).toMatchObject({
      operations: [
        'Cast field age in collection users from string to int',
        'Data transform: User.plan',
        'Remove field nickname from collection users',
        'Update validator on users (changed: age; added: plan; removed: nickname)',
      ],
      applied: [[1]],
    });
    expect(migrationTs(result)).toContain(
      compact(
        'run: () => rawUpdateMany("users", { $expr: { $in: [{ $type: "$plan" }, ["missing", "null"]] } }, placeholder("User.plan:update"), { bypassDocumentValidation: true })',
      ),
    );
  });

  it('fills an optional field made required', async () => {
    expect(
      (
        await scaffolded(
          plan({
            from: users('from', { plan: OPTIONAL_STRING }),
            to: users('to', { plan: STRING }),
            schema: [liveUsers({ plan: OPTIONAL_STRING })],
            statements: [fieldStatement('backfill', 'plan')],
          }),
        )
      ).operations,
    ).toEqual(['Data transform: User.plan', 'Update validator on users (changed: plan)']);
  });

  it('refuses a field that was already required, one that stays optional, and one in a new collection', () => {
    const refused = (
      from: Record<string, FieldTypeSpec> | null,
      to: Record<string, FieldTypeSpec>,
    ) =>
      refusal(
        plan({
          from: from === null ? null : users('from', from),
          to: users('to', to),
          schema: from === null ? [] : [liveUsers(from)],
          statements: [fieldStatement('backfill', 'plan')],
        }),
      ).map(({ summary }) => summary);

    expect([
      refused({ plan: STRING }, { plan: STRING }),
      refused({}, { plan: OPTIONAL_STRING }),
      refused(null, { plan: STRING }),
    ]).toEqual([
      ['Cannot backfill field "User.plan": it was already required'],
      ['Cannot backfill field "User.plan": it is optional'],
      [
        'Cannot backfill field "User.plan": collection "users" is new, so it has no documents to fill',
      ],
    ]);
  });
});

describe('MongoMigrationPlanner, a scaffold where a cast or fill would be refused', () => {
  const shared = (seed: string, user: Record<string, FieldTypeSpec>) =>
    contract(
      seed,
      {
        User: {
          collection: 'people',
          fields: ['_id', ...Object.keys(user)],
          types: { _id: OBJECT_ID, ...user },
        },
        Admin: {
          collection: 'people',
          fields: ['_id', 'age'],
          types: { _id: OBJECT_ID, age: STRING },
        },
      },
      { people: {} },
    );
  const readings = (seed: string, fields: Record<string, FieldTypeSpec>) =>
    contract(
      seed,
      {
        User: {
          collection: 'readings',
          fields: ['_id', 'at', ...Object.keys(fields)],
          types: { _id: OBJECT_ID, ...fields },
        },
      },
      { readings: { timeField: 'at' } },
    );
  const summaries = (result: ReturnType<typeof plan>) =>
    refusal(result).map(({ summary }) => summary);

  it('refuses --convert and --backfill in a collection another root model shares', () => {
    expect([
      summaries(
        plan({
          from: shared('from', { age: STRING }),
          to: shared('to', { age: INT }),
          schema: [schemaCollection('people')],
          statements: [fieldStatement('convert', 'age')],
        }),
      ),
      summaries(
        plan({
          from: shared('from', {}),
          to: shared('to', { plan: STRING }),
          schema: [schemaCollection('people')],
          statements: [fieldStatement('backfill', 'plan')],
        }),
      ),
    ]).toEqual([
      [
        'Cannot convert field "age" of model "User" in collection "people": model "Admin" stores it in the same collection',
      ],
      [
        'Cannot backfill field "plan" of model "User" in collection "people": model "Admin" is stored in the same collection',
      ],
    ]);
  });

  it('refuses --convert and --backfill in a time-series collection', () => {
    const live = [schemaCollection('readings', { timeseries: true })];

    expect([
      summaries(
        plan({
          from: readings('from', { age: STRING }),
          to: readings('to', { age: INT }),
          schema: live,
          statements: [fieldStatement('convert', 'age')],
        }),
      ),
      summaries(
        plan({
          from: readings('from', {}),
          to: readings('to', { plan: STRING }),
          schema: live,
          statements: [fieldStatement('backfill', 'plan')],
        }),
      ),
    ]).toEqual([
      ['Cannot convert field "age" in collection "readings": it is a time-series collection'],
      ['Cannot backfill field "plan" in collection "readings": it is a time-series collection'],
    ]);
  });
});

describe('MongoMigrationPlanner, a scaffold on a field the plan cannot rewrite', () => {
  const stored = (
    seed: string,
    field: FieldTypeSpec,
    options: { storedAs?: string; control?: 'external' },
  ) =>
    contract(
      seed,
      {
        User: {
          collection: 'users',
          fields: ['_id', 'age'],
          types: { _id: OBJECT_ID, age: field },
          ...(options.storedAs === undefined ? {} : { storedAs: { age: options.storedAs } }),
        },
      },
      { users: options.control === undefined ? {} : { control: options.control } },
    );
  const reasons = (
    statement: 'convert' | 'backfill',
    options: { storedAs?: string; control?: 'external' },
  ) =>
    refusal(
      plan({
        from: stored('from', statement === 'convert' ? STRING : OPTIONAL_STRING, options),
        to: stored('to', statement === 'convert' ? INT : STRING, options),
        schema: [schemaCollection('users')],
        statements: [fieldStatement(statement, 'age')],
      }),
    ).map(({ summary }) => summary);

  it('refuses a stored name MongoDB reads as a path, and a collection the plan does not manage, with the real reason', () => {
    expect([
      reasons('convert', { storedAs: 'a.b' }),
      reasons('backfill', { storedAs: 'a.b' }),
      reasons('convert', { control: 'external' }),
      reasons('backfill', { control: 'external' }),
    ]).toEqual([
      [
        'Cannot convert field "User.age": its stored name "a.b" cannot be rewritten: MongoDB reads a name containing "." as a path into embedded documents',
      ],
      [
        'Cannot backfill field "User.age": its stored name "a.b" cannot be rewritten: MongoDB reads a name containing "." as a path into embedded documents',
      ],
      ['Cannot convert field "User.age": collection "users" has control policy "external"'],
      ['Cannot backfill field "User.age": collection "users" has control policy "external"'],
    ]);
  });
});
