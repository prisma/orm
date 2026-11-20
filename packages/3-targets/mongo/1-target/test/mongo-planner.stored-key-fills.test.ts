import type {
  MigrationSubject,
  ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { workspaceMigrationModule } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';
import {
  type CollectionSpec,
  contract,
  type FieldTypeSpec,
  listedOperations,
  type ModelSpec,
  NS,
  plan,
  refusal,
  schemaCollection,
} from './mongo-statement-fixtures';

const OBJECT_ID: FieldTypeSpec = { codecId: 'mongo/objectId@1' };
const STRING: FieldTypeSpec = { codecId: 'mongo/string@1' };
const OPTIONAL_STRING: FieldTypeSpec = { codecId: 'mongo/string@1', nullable: true };
const INT: FieldTypeSpec = { codecId: 'mongo/int32@1' };
const DATE: FieldTypeSpec = { codecId: 'mongo/date@1' };

function voField(valueObject: string, extra: Partial<FieldTypeSpec> = {}): FieldTypeSpec {
  return { codecId: '', valueObject, ...extra };
}

/** Users holding addresses as a list; `address` gives the fields of `Address`. */
function users(
  seed: string,
  address: Record<string, FieldTypeSpec>,
  collection: CollectionSpec = {},
  userTypes: Record<string, FieldTypeSpec> = {},
) {
  const types = { addresses: voField('Address', { many: true }), ...userTypes };
  return contract(
    seed,
    {
      User: {
        collection: 'users',
        fields: ['_id', ...Object.keys(types)],
        types: { _id: OBJECT_ID, ...types },
      },
    },
    { users: collection },
    { Address: address },
  );
}

/** Users embedding a list of `Address` documents; `address` gives the embedded model's fields. */
function embeddingUsers(seed: string, address: Record<string, FieldTypeSpec>) {
  return contract(
    seed,
    {
      User: {
        collection: 'users',
        fields: ['_id'],
        types: { _id: OBJECT_ID },
        embeds: { addresses: { field: 'addresses', model: 'Address' } },
      },
      Address: { owner: 'User', fields: Object.keys(address), types: address },
    },
    { users: {} },
  );
}

const live = [schemaCollection('users')];

const addressField = (field: string) => ({ namespaceId: NS, valueObject: 'Address', field });

const backfillAddress = (field: string): ResolvedMigrationStatement => ({
  kind: 'backfill',
  entity: 'valueObjectField',
  field: addressField(field),
});

const addressSubject = (field: string): MigrationSubject => ({
  kind: 'valueObjectField',
  ...addressField(field),
});

/** The fill calls of the plan's migration.ts, without white space. */
function fillCalls(result: ReturnType<typeof plan>): readonly string[] {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  const source = (result.plan as PlannerProducedMongoMigration)
    .renderTypeScript(workspaceMigrationModule.mongo)
    .replace(/\s+/g, '')
    .replace(/,\}/g, '}');
  return source.match(/fillStoredKey\(\{.*?\}\)(?=,|\])/g) ?? [];
}

function temporaryValues(result: ReturnType<typeof plan>) {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  return result.temporaryValues;
}

describe('MongoMigrationPlanner, a required field new inside a value object', () => {
  it('fills each object with the temporary value of its type, typed as the field', () => {
    const result = plan({
      from: users('from', { street: STRING }),
      to: users('to', {
        street: STRING,
        count: INT,
        big: { codecId: 'mongo/int64@1' },
        ratio: { codecId: 'mongo/double@1' },
        active: { codecId: 'mongo/bool@1' },
      }),
      schema: live,
    });

    expect({ calls: fillCalls(result), temporaryValues: temporaryValues(result) }).toEqual({
      calls: [
        'fillStoredKey({collection:"users",field:"addresses",path:"$[*].active",value:false})',
        'fillStoredKey({collection:"users",field:"addresses",path:"$[*].big",value:{$toLong:0}})',
        'fillStoredKey({collection:"users",field:"addresses",path:"$[*].count",value:0})',
        'fillStoredKey({collection:"users",field:"addresses",path:"$[*].ratio",value:{$toDouble:0}})',
      ],
      temporaryValues: [
        { operationIndex: 0, subject: addressSubject('active'), value: 'false' },
        { operationIndex: 1, subject: addressSubject('big'), value: '0' },
        { operationIndex: 2, subject: addressSubject('count'), value: '0' },
        { operationIndex: 3, subject: addressSubject('ratio'), value: '0' },
      ],
    });
  });

  it('fills a list field with an empty list and a value object held once, and leaves an optional field made required to the document check', () => {
    const holders = (seed: string, address: Record<string, FieldTypeSpec>) =>
      users(seed, address, {}, { home: voField('Address', { nullable: true }) });

    expect(
      fillCalls(
        plan({
          from: holders('from', { city: OPTIONAL_STRING }),
          to: holders('to', { city: STRING, tags: { codecId: 'mongo/string@1', many: true } }),
          schema: live,
        }),
      ),
    ).toEqual([
      'fillStoredKey({collection:"users",field:"addresses",path:"$[*].tags",value:[]})',
      'fillStoredKey({collection:"users",field:"home",path:"$.tags",value:[]})',
    ]);
  });

  it("fills a variant's value object in that variant's documents only", () => {
    const tasks = (seed: string, address: Record<string, FieldTypeSpec>) =>
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
          Bug: {
            collection: 'tasks',
            fields: ['where'],
            types: { where: voField('Address') },
            base: 'Task',
          },
        },
        { tasks: {} },
        { Address: address },
      );

    expect(
      fillCalls(
        plan({
          from: tasks('from', { street: STRING }),
          to: tasks('to', { street: STRING, zip: STRING }),
          schema: [schemaCollection('tasks')],
        }),
      ),
    ).toEqual([
      'fillStoredKey({collection:"tasks",field:"where",path:"$.zip",value:{$literal:""},filter:{type:"bug"}})',
    ]);
  });

  it('fills nothing for a type with no temporary value, a value object field, or a field under a unique index, and does not warn', () => {
    const result = (from: ReturnType<typeof users>, to: ReturnType<typeof users>) =>
      plan({ from, to, schema: [schemaCollection('users', { unique: ['addresses.code'] })] });
    const outcomes = [
      result(users('from', {}), users('to', { at: DATE })),
      result(
        contract('from', usersHolding({}), { users: {} }, { Address: {}, Geo: { lat: STRING } }),
        contract(
          'to',
          usersHolding({ geo: voField('Geo') }),
          { users: {} },
          { Address: { geo: voField('Geo') }, Geo: { lat: STRING } },
        ),
      ),
      result(
        users('from', {}, { unique: ['addresses.code'] }),
        users('to', { code: STRING }, { unique: ['addresses.code'] }),
      ),
    ];

    expect(
      outcomes.map((outcome) => ({
        calls: fillCalls(outcome),
        temporaryValues: temporaryValues(outcome),
        warnings: outcome.kind === 'success' ? (outcome.warnings ?? []) : outcome,
      })),
    ).toEqual([
      { calls: [], temporaryValues: [], warnings: [] },
      { calls: [], temporaryValues: [], warnings: [] },
      { calls: [], temporaryValues: [], warnings: [] },
    ]);
  });

  it('fills nothing for a field a rename gives its new name, and fills it in a new collection never', () => {
    const rename: ResolvedMigrationStatement = {
      kind: 'rename',
      entity: 'valueObjectField',
      from: addressField('zip'),
      to: addressField('code'),
    };

    expect([
      fillCalls(
        plan({
          from: users('from', { zip: STRING }),
          to: users('to', { code: STRING }),
          schema: live,
          statements: [rename],
        }),
      ),
      fillCalls(plan({ from: users('from', {}), to: users('to', { code: STRING }), schema: [] })),
    ]).toEqual([[], []]);
  });

  it('refuses a fill in a time-series collection, and leaves out a collection whose control policy is not managed', () => {
    const readings = (seed: string, address: Record<string, FieldTypeSpec>) =>
      contract(
        seed,
        {
          Reading: {
            collection: 'readings',
            fields: ['_id', 'at', 'place'],
            types: { _id: OBJECT_ID, at: DATE, place: voField('Address') },
          },
        },
        { readings: { timeField: 'at' } },
        { Address: address },
      );

    expect([
      refusal(
        plan({
          from: readings('from', {}),
          to: readings('to', { zip: STRING }),
          schema: [schemaCollection('readings', { timeseries: true })],
        }),
      ).map(({ summary }) => summary),
      fillCalls(
        plan({
          from: users('from', {}, { control: 'tolerated' }),
          to: users('to', { zip: STRING }, { control: 'tolerated' }),
          schema: live,
        }),
      ),
    ]).toEqual([
      [
        'Cannot fill value object field "Address.zip" inside field "place" in collection "readings": it is a time-series collection',
      ],
      [],
    ]);
  });
});

function usersHolding(types: Record<string, FieldTypeSpec>): Readonly<Record<string, ModelSpec>> {
  const all = { addresses: voField('Address', { many: true }), ...types };
  return {
    User: {
      collection: 'users',
      fields: ['_id', ...Object.keys(all)],
      types: { _id: OBJECT_ID, ...all },
    },
  };
}

describe('MongoMigrationPlanner, a required field new in an embedded model', () => {
  it('fills each embedded document with the temporary value, reported as the field', () => {
    const result = plan({
      from: embeddingUsers('from', { street: STRING }),
      to: embeddingUsers('to', { street: STRING, code: STRING }),
      schema: live,
    });

    expect({
      calls: fillCalls(result),
      temporaryValues: temporaryValues(result),
      warnings: result.kind === 'success' ? (result.warnings ?? []) : result,
    }).toEqual({
      calls: [
        'fillStoredKey({collection:"users",field:"addresses",path:"$[*].code",value:{$literal:""}})',
      ],
      temporaryValues: [
        {
          operationIndex: 0,
          subject: { kind: 'field', namespaceId: NS, model: 'Address', field: 'code' },
          value: '""',
        },
      ],
      warnings: [],
    });
  });
});

describe('MongoMigrationPlanner, --backfill of a field inside a value object or an embedded model', () => {
  it('writes a fill with a placeholder value at each place, and lists it before the value is written', async () => {
    const result = plan({
      from: users('from', {}, {}, { home: voField('Address', { nullable: true }) }),
      to: users('to', { zip: STRING }, {}, { home: voField('Address', { nullable: true }) }),
      schema: live,
      statements: [backfillAddress('zip')],
    });
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
    const label = (field: string, path: string) =>
      `Fill key "zip" at path "${path}" in field ${field} of collection users where it is missing or null`;

    expect({
      calls: fillCalls(result),
      operations: await listedOperations(result.plan as PlannerProducedMongoMigration),
      applied: result.appliedStatements.map(({ operationIndexes }) => operationIndexes),
      temporaryValues: result.temporaryValues,
    }).toEqual({
      calls: [
        'fillStoredKey({collection:"users",field:"addresses",path:"$[*].zip",value:placeholder("Address.zip:value")})',
        'fillStoredKey({collection:"users",field:"home",path:"$.zip",value:placeholder("Address.zip:value")})',
      ],
      operations: [
        expect.objectContaining({ label: label('addresses', '$[*]'), operationClass: 'widening' }),
        expect.objectContaining({ label: label('home', '$'), operationClass: 'widening' }),
      ],
      applied: [[0, 1]],
      temporaryValues: [],
    });
  });

  it('writes a fill with a placeholder for a field of an embedded model', () => {
    expect(
      fillCalls(
        plan({
          from: embeddingUsers('from', { street: STRING }),
          to: embeddingUsers('to', { street: STRING, at: DATE }),
          schema: live,
          statements: [
            {
              kind: 'backfill',
              entity: 'field',
              field: { namespaceId: NS, model: 'Address', field: 'at' },
            },
          ],
        }),
      ),
    ).toEqual([
      'fillStoredKey({collection:"users",field:"addresses",path:"$[*].at",value:placeholder("Address.at:value")})',
    ]);
  });

  it('refuses a backfill in a collection whose control policy is not managed', () => {
    expect(
      refusal(
        plan({
          from: users('from', {}, { control: 'tolerated' }),
          to: users('to', { zip: STRING }, { control: 'tolerated' }),
          schema: live,
          statements: [backfillAddress('zip')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot backfill value object field "Address.zip": collection "users" has control policy "tolerated"',
        why: 'Statements fill only fields of collections whose control policy is "managed". Fill the field in the database yourself and leave out this statement.',
      },
    ]);
  });

  it('refuses a backfill through a value object that contains itself, with a route by hand under either command', () => {
    const trees = (seed: string, address: Record<string, FieldTypeSpec>) =>
      contract(
        seed,
        {
          User: {
            collection: 'users',
            fields: ['_id', 'tree'],
            types: { _id: OBJECT_ID, tree: voField('Tree') },
          },
        },
        { users: {} },
        {
          Address: address,
          Tree: { at: voField('Address'), children: voField('Tree', { many: true }) },
        },
      );
    expect(
      refusal(
        plan({
          from: trees('from', { street: STRING }),
          to: trees('to', { street: STRING, zip: STRING }),
          schema: live,
          statements: [backfillAddress('zip')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot backfill value object field "Address.zip": field "tree" of collection "users" holds it inside "Tree", which contains itself, so the documents can hold it at any depth',
        why: 'The plan fills a key at every path from a field to its objects, and a type that contains itself has no last path. Fill the key in field "tree" of collection "users" yourself, in a dataTransform operation of the migration.ts that migration plan writes or in mongosh, or leave out this statement.',
      },
    ]);
  });

  it('refuses a backfill of a field that was already required', () => {
    expect(
      refusal(
        plan({
          from: users('from', { zip: STRING }),
          to: users('to', { zip: STRING }),
          schema: live,
          statements: [backfillAddress('zip')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot backfill value object field "Address.zip": no existing object is known to lack it, since the origin contract has no such field that is optional, nor this value object or embedded model without it',
        why: 'A --backfill statement fills a required field that a value object or an embedded model gains, or that was optional. Leave out this statement.',
      },
    ]);
  });

  it('still refuses --convert of a field of an embedded model', () => {
    expect(
      refusal(
        plan({
          from: embeddingUsers('from', { zip: STRING }),
          to: embeddingUsers('to', { zip: INT }),
          schema: live,
          statements: [
            {
              kind: 'convert',
              entity: 'field',
              field: { namespaceId: NS, model: 'Address', field: 'zip' },
            },
          ],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot convert field "Address.zip": model "Address" is embedded in the documents of model "User"',
        why: 'A --convert statement converts a field of a model or a variant. Converting a field inside a value object or an embedded model is not a statement on any database in this release: rewrite the values yourself, in a dataTransform operation of the migration.ts that migration plan writes or in mongosh, and leave out this statement.',
      },
    ]);
  });
});

describe('MongoMigrationPlanner, a value object that loses a field and gains a required one', () => {
  it('removes the old key and fills the new one, and with a rename renames it and fills nothing', () => {
    const rename: ResolvedMigrationStatement = {
      kind: 'rename',
      entity: 'valueObjectField',
      from: addressField('zip'),
      to: addressField('country'),
    };
    const removed = plan({
      from: users('from', { street: STRING, zip: STRING }),
      to: users('to', { street: STRING, country: STRING }),
      schema: live,
    });
    const renamed = plan({
      from: users('from', { street: STRING, zip: STRING }),
      to: users('to', { street: STRING, country: STRING }),
      schema: live,
      statements: [rename],
    });

    expect({
      removed: {
        fills: fillCalls(removed),
        lost: removed.kind === 'success' ? removed.dataLoss.map(({ subject }) => subject) : [],
      },
      renamed: fillCalls(renamed),
    }).toEqual({
      removed: {
        fills: [
          'fillStoredKey({collection:"users",field:"addresses",path:"$[*].country",value:{$literal:""}})',
        ],
        lost: [addressSubject('zip')],
      },
      renamed: [],
    });
  });
});
