import { buildMongoStorage, mongoValueSetsOf } from '@internal/mongo-contract';
import { describe, expect, it } from 'vitest';
import { live, rendered, STATUS, users } from './mongo-enum-fixtures';
import { contract, plan, planned, schemaCollection } from './mongo-statement-fixtures';

describe('MongoMigrationPlanner, an enum value that keeps its name and changes its stored value', () => {
  it('replaces the stored value in a nullable field and a list, and asks nothing', () => {
    const result = plan({
      from: users('from', { ACTIVE: 'active', ARCHIVED: 'archived' }),
      to: users('to', { ACTIVE: 'active', ARCHIVED: 'retired' }),
      schema: live,
    });
    expect({ ...planned(result), rendered: rendered(result) }).toEqual({
      applied: [],
      classes: ['widening', 'widening'],
      dataLoss: [],
      labels: [
        'Replace value "archived" with "retired" in field status of collection users',
        'Replace value "archived" with "retired" in field tags of collection users',
      ],
      rendered: [
        'replaceStoredValue({collection:"users",field:"status",from:"archived",to:{$literal:"retired"}})',
        'replaceStoredValue({collection:"users",field:"tags",from:"archived",to:{$literal:"retired"}})',
      ],
    });
  });

  it('replaces numeric stored values with the type the codec stores', () => {
    const result = plan({
      from: users(
        'from',
        { LOW: 1, HIGH: 2 },
        {
          codecId: 'mongo/int32@1',
          types: { level: { codecId: 'mongo/int32@1', valueSet: 'Status' } },
        },
      ),
      to: users(
        'to',
        { LOW: 1, HIGH: 3 },
        {
          codecId: 'mongo/int32@1',
          types: { level: { codecId: 'mongo/int32@1', valueSet: 'Status' } },
        },
      ),
      schema: live,
    });
    expect({ ...planned(result), rendered: rendered(result) }).toEqual({
      labels: ['Replace value 2 with 3 in field level of collection users'],
      classes: ['widening'],
      applied: [],
      dataLoss: [],
      rendered: ['replaceStoredValue({collection:"users",field:"level",from:2,to:3})'],
    });
  });

  it('replaces it inside a value object and an embedded model', () => {
    const options = {
      types: { home: { codecId: 'mongo/string@1', valueObject: 'Place', nullable: true } },
      valueObjects: { Place: { status: { ...STATUS, nullable: true } } },
      models: {
        Note: {
          owner: 'User',
          fields: ['status'],
          types: { status: { ...STATUS, nullable: true } },
        },
        User: {
          collection: 'users',
          fields: ['_id', 'home'],
          types: { home: { codecId: 'mongo/string@1', valueObject: 'Place', nullable: true } },
          embeds: { notes: { field: 'notes', model: 'Note' } },
        },
      },
    };
    const result = plan({
      from: users('from', { ACTIVE: 'active', ARCHIVED: 'archived' }, options),
      to: users('to', { ACTIVE: 'active', ARCHIVED: 'retired' }, options),
      schema: live,
    });
    expect({ ...planned(result), rendered: rendered(result) }).toEqual({
      labels: [
        'Replace value "archived" with "retired" at path "$[*].status" in field notes of collection users',
        'Replace value "archived" with "retired" at path "$.status" in field home of collection users',
      ],
      classes: ['widening', 'widening'],
      applied: [],
      dataLoss: [],
      rendered: [
        'replaceStoredValue({collection:"users",field:"notes",path:"$[*].status",from:"archived",to:{$literal:"retired"}})',
        'replaceStoredValue({collection:"users",field:"home",path:"$.status",from:"archived",to:{$literal:"retired"}})',
      ],
    });
  });

  it('plans a value it frees and a new member takes', () => {
    expect(
      rendered(
        plan({
          from: users('from', { ACTIVE: 'active', ARCHIVED: 'archived' }),
          to: users('to', { ACTIVE: 'active', ARCHIVED: 'retired', LEGACY: 'archived' }),
          schema: live,
        }),
      ),
    ).toEqual([
      'replaceStoredValue({collection:"users",field:"status",from:"archived",to:{$literal:"retired"}})',
      'replaceStoredValue({collection:"users",field:"tags",from:"archived",to:{$literal:"retired"}})',
    ]);
  });

  it('updates the validator enum list after the replacement', () => {
    const schemaOf = (values: readonly string[]) => ({
      bsonType: 'object',
      properties: { _id: { bsonType: 'objectId' }, status: { enum: values } },
    });
    expect(
      planned(
        plan({
          from: users(
            'from',
            { ACTIVE: 'active', ARCHIVED: 'archived' },
            {
              types: { status: { ...STATUS, nullable: true } },
              collection: { jsonSchema: schemaOf(['active', 'archived']) },
            },
          ),
          to: users(
            'to',
            { ACTIVE: 'active', ARCHIVED: 'retired' },
            {
              types: { status: { ...STATUS, nullable: true } },
              collection: { jsonSchema: schemaOf(['active', 'retired']) },
            },
          ),
          schema: [schemaCollection('users', { jsonSchema: schemaOf(['active', 'archived']) })],
        }),
      ),
    ).toEqual({
      classes: ['widening', 'widening'],
      applied: [],
      dataLoss: [],
      labels: [
        'Replace value "archived" with "retired" in field status of collection users',
        'Update validator on users (changed: status)',
      ],
    });
  });

  it('leaves a variant discriminator the enum types to the variant change, which deletes the documents of the variant and asks about them', () => {
    const tasks = (seed: string, bug: string) =>
      contract(
        seed,
        {
          Task: {
            collection: 'tasks',
            fields: ['_id', 'type'],
            types: { type: STATUS },
            discriminator: 'type',
            variants: { Bug: bug },
          },
          Bug: { fields: [], base: 'Task' },
        },
        { tasks: {} },
        {},
        { Status: { members: { BUG: bug } } },
      );
    expect(
      planned(
        plan({
          from: tasks('from', 'bug'),
          to: tasks('to', 'defect'),
          schema: [schemaCollection('tasks')],
        }),
      ),
    ).toEqual({
      applied: [],
      classes: ['destructive'],
      dataLoss: [
        {
          label: 'Delete the documents of collection tasks whose type is "bug"',
          loss: 'drop',
          operationIndex: 0,
          subject: {
            kind: 'model',
            model: 'Bug',
            namespaceId: '__unbound__',
          },
        },
      ],
      labels: ['Delete the documents of collection tasks whose type is "bug"'],
    });
  });

  it('plans nothing without an origin contract', () => {
    expect(
      rendered(
        plan({
          from: null,
          to: users('to', { ACTIVE: 'active', ARCHIVED: 'retired' }),
          schema: live,
        }),
      ),
    ).toEqual([]);
  });
});

describe('MongoMigrationPlanner, an enum the root models of one collection type alike', () => {
  const shared = (seed: string, members: Readonly<Record<string, unknown>>) =>
    users(seed, members, {
      types: { status: { ...STATUS, nullable: true } },
      models: {
        Admin: {
          collection: 'users',
          fields: ['_id', 'status'],
          types: { status: { ...STATUS, nullable: true } },
        },
      },
    });

  it('replaces a changed stored value once in every document', () => {
    expect(
      planned(
        plan({
          from: shared('from', { A: 'a', B: 'b' }),
          to: shared('to', { A: 'a', B: 'c' }),
          schema: live,
        }),
      ),
    ).toEqual({
      labels: ['Replace value "b" with "c" in field status of collection users'],
      classes: ['widening'],
      applied: [],
      dataLoss: [],
    });
  });
});

describe('MongoMigrationPlanner, an enum value change with no statement in a collection that is not managed', () => {
  it('plans nothing', () => {
    const external = (seed: string, members: Readonly<Record<string, unknown>>) =>
      users(seed, members, { collection: { control: 'external' } });
    expect(
      planned(
        plan({
          from: external('from', { A: 'a', B: 'b' }),
          to: external('to', { A: 'b', B: 'a' }),
          schema: live,
        }),
      ),
    ).toEqual({ labels: [], classes: [], applied: [], dataLoss: [] });
  });
});

describe('the MongoDB storage hash of an enum whose stored values trade places', () => {
  it('changes, because the value set lists the stored values in member order', () => {
    const hashOf = (members: Readonly<Record<string, string>>) =>
      buildMongoStorage({
        namespaceId: '__unbound__',
        collections: { users: {} },
        valueSets: mongoValueSetsOf({
          Status: {
            codecId: 'mongo/string@1',
            members: Object.entries(members).map(([name, value]) => ({ name, value })),
          },
        }),
      }).storageHash;
    expect(hashOf({ ACTIVE: 'archived', ARCHIVED: 'active' })).not.toBe(
      hashOf({ ACTIVE: 'active', ARCHIVED: 'archived' }),
    );
  });
});
