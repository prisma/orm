import { describe, expect, it } from 'vitest';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';
import {
  contract,
  type FieldTypeSpec,
  NS,
  plan,
  planned,
  refusal,
  renameField,
  schemaCollection,
  settledOperations,
} from './mongo-statement-fixtures';

const OBJECT_ID: FieldTypeSpec = { codecId: 'mongo/objectId@1' };
const INT: FieldTypeSpec = { codecId: 'mongo/int32@1' };
const BIG_INT: FieldTypeSpec = { codecId: 'mongo/int64@1' };
const STRING: FieldTypeSpec = { codecId: 'mongo/string@1' };
const DATE: FieldTypeSpec = { codecId: 'mongo/date@1' };

function closedSchema(properties: Record<string, Record<string, unknown>>) {
  return {
    bsonType: 'object',
    required: ['_id', ...Object.keys(properties)],
    properties: { _id: { bsonType: 'objectId' }, ...properties },
    additionalProperties: false,
  };
}

function users(seed: string, fields: Record<string, FieldTypeSpec>, collection = 'users') {
  const properties = Object.fromEntries(
    Object.entries(fields).map(([field, type]) => [field, schemaOf(type)]),
  );
  return contract(
    seed,
    {
      User: {
        collection,
        fields: ['_id', ...Object.keys(fields)],
        types: { _id: OBJECT_ID, ...fields },
      },
    },
    { [collection]: { jsonSchema: closedSchema(properties) } },
  );
}

const BSON_TYPE: Readonly<Record<string, string>> = {
  'mongo/int32@1': 'int',
  'mongo/int64@1': 'long',
  'mongo/string@1': 'string',
  'mongo/date@1': 'date',
  'mongo/double@1': 'double',
};

function schemaOf(type: FieldTypeSpec): Record<string, unknown> {
  const bsonType = BSON_TYPE[type.codecId];
  if (bsonType === undefined) return {};
  return type.many === true ? { bsonType: 'array', items: { bsonType } } : { bsonType };
}

function liveUsers(fields: Record<string, FieldTypeSpec>, collection = 'users') {
  return schemaCollection(collection, {
    jsonSchema: closedSchema(
      Object.fromEntries(Object.entries(fields).map(([field, type]) => [field, schemaOf(type)])),
    ),
  });
}

describe('MongoMigrationPlanner, a field whose type changes', () => {
  describe('with the origin contract', () => {
    it('casts Int to BigInt with nothing asked, before the validator change', () => {
      expect(
        planned(
          plan({
            from: users('from', { age: INT }),
            to: users('to', { age: BIG_INT }),
            schema: [liveUsers({ age: INT })],
          }),
        ),
      ).toEqual({
        labels: [
          'Cast field age in collection users from int to long',
          'Update validator on users (changed: age)',
        ],
        classes: ['widening', 'widening'],
        applied: [],
        dataLoss: [],
      });
    });

    it('plans only the validator change when the new type takes every old value', () => {
      expect(
        [{ codecId: 'mongo/bson@1' }, { codecId: 'mongo/json@1' }].map(
          (to) =>
            planned(
              plan({
                from: users('from', { age: INT }),
                to: users('to', { age: to }),
                schema: [liveUsers({ age: INT })],
              }),
            ).labels,
        ),
      ).toEqual([
        ['Update validator on users (changed: age)'],
        ['Update validator on users (changed: age)'],
      ]);
    });

    it('asks about a cast that can change or lose values, as a type change of the field', () => {
      expect(
        planned(
          plan({
            from: users('from', { age: STRING }),
            to: users('to', { age: INT }),
            schema: [liveUsers({ age: STRING })],
          }),
        ),
      ).toEqual({
        labels: [
          'Cast field age in collection users from string to int',
          'Update validator on users (changed: age)',
        ],
        classes: ['destructive', 'widening'],
        applied: [],
        dataLoss: [
          {
            operationIndex: 0,
            subject: { kind: 'field', namespaceId: NS, model: 'User', field: 'age' },
            loss: 'typeChange',
            label: 'Cast field age in collection users from string to int',
          },
        ],
      });
    });

    it('casts each element of a list', () => {
      const result = plan({
        from: users('from', { scores: { ...INT, many: true } }),
        to: users('to', { scores: { codecId: 'mongo/double@1', many: true } }),
        schema: [liveUsers({ scores: { ...INT, many: true } })],
      });

      expect(planned(result)).toMatchObject({
        labels: [
          'Cast field scores in collection users from int to double',
          'Update validator on users (changed: scores)',
        ],
        classes: ['widening', 'widening'],
      });
      const [cast] =
        result.kind === 'success'
          ? settledOperations(result.plan as PlannerProducedMongoMigration)
          : [];
      expect(cast).toMatchObject({
        run: [{ command: { update: [{ $set: { scores: { $map: { input: '$scores' } } } }] } }],
      });
    });

    it("casts a variant's field in that variant's documents only", () => {
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
        planned(
          plan({
            from: tasks('from', INT),
            to: tasks('to', BIG_INT),
            schema: [schemaCollection('tasks')],
          }),
        ).labels,
      ).toEqual([
        'Cast field severity in collection tasks from int to long in documents whose type is "bug"',
      ]);
    });

    it('casts a field under its new name after a rename, and before a removal', () => {
      expect(
        planned(
          plan({
            from: users('from', { age: INT, nickname: STRING }),
            to: users('to', { years: BIG_INT }),
            schema: [liveUsers({ age: INT, nickname: STRING })],
            statements: [renameField('User', 'age', 'User', 'years')],
          }),
        ).labels,
      ).toEqual([
        'Rename field age to years in collection users',
        'Cast field years in collection users from int to long',
        'Remove field nickname from collection users',
        'Update validator on users (added: years; removed: age, nickname)',
      ]);
    });

    it('refuses a type change $convert has no cast for, pointing to --convert', () => {
      expect(
        refusal(
          plan({
            from: users('from', { age: DATE }),
            to: users('to', { age: INT }),
            schema: [liveUsers({ age: DATE })],
          }),
        ),
      ).toEqual([
        {
          kind: 'typeChangeRefused',
          summary:
            'Cannot change the type of field "User.age" in collection "users" from date to int: MongoDB has no cast from date to int',
          why: 'Its values cannot be cast, so --delete cannot keep the field. Plan the change with migration plan and --convert User.age, and write the conversion in migration.ts.',
        },
      ]);
    });

    it('refuses a cast in a time-series collection', () => {
      expect(
        refusal(
          plan({
            from: users('from', { age: INT }, 'readings'),
            to: users('to', { age: BIG_INT }, 'readings'),
            schema: [schemaCollection('readings', { timeseries: true })],
          }),
        ),
      ).toEqual([
        {
          kind: 'typeChangeRefused',
          summary:
            'Cannot cast field "age" in collection "readings": it is a time-series collection',
          why: "MongoDB updates the documents of a time-series collection only through its metaField, so the values of the field cannot be cast. Keep the field's type in the contract, then run this command again.",
        },
      ]);
    });

    it('refuses a cast in a collection another root model shares without a discriminator', () => {
      const people = (seed: string, age: FieldTypeSpec) =>
        contract(
          seed,
          {
            User: { collection: 'people', fields: ['_id', 'age'], types: { _id: OBJECT_ID, age } },
            Admin: {
              collection: 'people',
              fields: ['_id', 'age'],
              types: { _id: OBJECT_ID, age: INT },
            },
          },
          { people: {} },
        );

      expect(
        refusal(
          plan({
            from: people('from', INT),
            to: people('to', BIG_INT),
            schema: [schemaCollection('people')],
          }),
        ),
      ).toEqual([
        {
          kind: 'typeChangeRefused',
          summary:
            'Cannot cast field "age" of model "User" in collection "people": model "Admin" stores it in the same collection',
          why: 'Collection "people" stores several models and no discriminator tells their documents apart, so casting the field would cast it in the documents of "Admin" too. To change it in "User" documents only, move the models to separate collections, or carry out the change in a dataTransform operation of a migration.ts, with a filter that selects only their documents.',
        },
      ]);
    });
  });

  describe('without the origin contract', () => {
    it('finds the type change from the two validators and names the field by its storage name', () => {
      expect(
        planned(
          plan({
            from: null,
            to: users('to', { age: INT }),
            schema: [liveUsers({ age: STRING })],
          }),
        ),
      ).toEqual({
        labels: [
          'Cast field age in collection users from string to int',
          'Update validator on users (changed: age)',
        ],
        classes: ['destructive', 'widening'],
        applied: [],
        dataLoss: [
          {
            operationIndex: 0,
            subject: { kind: 'storage', name: 'users.age' },
            loss: 'typeChange',
            label: 'Cast field age in collection users from string to int',
          },
        ],
      });
    });

    it('refuses Bson to Json, since a Bson field can hold values Json cannot, pointing to --from', () => {
      const live = schemaCollection('users', { jsonSchema: closedSchema({ meta: {} }) });
      const destination = contract(
        'to',
        { User: { collection: 'users', fields: ['_id', 'meta'], types: { _id: OBJECT_ID } } },
        {
          users: {
            jsonSchema: closedSchema({
              meta: { bsonType: ['object', 'array', 'string', 'double', 'int', 'long', 'bool'] },
            }),
          },
        },
      );

      expect(refusal(plan({ from: null, to: destination, schema: [live] }))).toEqual([
        {
          kind: 'typeChangeRefused',
          summary:
            'Cannot change the type of field "users.meta" in collection "users" from any value to object, array, string, double, int, long, bool: MongoDB has no cast from any value to object, array, string, double, int, long, bool',
          why: 'Its values cannot be cast, so --delete cannot keep the field. Plan the change with migration plan --from <hash of the migration the database is at> and --convert, and write the conversion in migration.ts.',
        },
      ]);
    });

    it('reads null as allowed on both sides, an empty set as any value, and a list through its items', () => {
      const live = schemaCollection('users', {
        jsonSchema: closedSchema({
          age: { bsonType: ['null', 'int'] },
          scores: { bsonType: 'array', items: { bsonType: 'int' } },
          meta: { bsonType: 'object' },
        }),
      });
      const destination = contract(
        'to',
        {
          User: {
            collection: 'users',
            fields: ['_id', 'age', 'scores', 'meta'],
            types: { _id: OBJECT_ID },
          },
        },
        {
          users: {
            jsonSchema: closedSchema({
              age: { bsonType: 'long' },
              scores: { bsonType: 'array', items: { bsonType: 'long' } },
              meta: {},
            }),
          },
        },
      );

      expect(planned(plan({ from: null, to: destination, schema: [live] })).labels).toEqual([
        'Cast field age in collection users from int to long',
        'Cast field scores in collection users from int to long',
        'Update validator on users (changed: age, scores, meta)',
      ]);
    });
  });
});
