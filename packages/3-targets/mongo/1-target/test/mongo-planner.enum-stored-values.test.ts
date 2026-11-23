import { buildMongoStorage, mongoValueSetsOf } from '@internal/mongo-contract';
import { workspaceMigrationModule } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';
import {
  type CollectionSpec,
  contract,
  type EnumSpec,
  type FieldTypeSpec,
  type ModelSpec,
  plan,
  planned,
  schemaCollection,
} from './mongo-statement-fixtures';

const STATUS: FieldTypeSpec = { codecId: 'mongo/string@1', valueSet: 'Status' };
const TYPES = { status: { ...STATUS, nullable: true }, tags: { ...STATUS, many: true } };

/** Users whose fields `types` names are typed by `Status`. */
function users(
  seed: string,
  members: Readonly<Record<string, unknown>>,
  options: {
    readonly types?: Readonly<Record<string, FieldTypeSpec>>;
    readonly codecId?: string;
    readonly collection?: CollectionSpec;
    readonly models?: Readonly<Record<string, ModelSpec>>;
    readonly valueObjects?: Readonly<Record<string, Readonly<Record<string, FieldTypeSpec>>>>;
  } = {},
) {
  const types = options.types ?? TYPES;
  const status: EnumSpec = {
    members,
    ...(options.codecId === undefined ? {} : { codecId: options.codecId }),
  };
  return contract(
    seed,
    {
      User: { collection: 'users', fields: ['_id', ...Object.keys(types)], types },
      ...options.models,
    },
    { users: options.collection ?? {} },
    options.valueObjects ?? {},
    { Status: status },
  );
}

const live = [schemaCollection('users')];

/** The stored value calls of the plan's migration.ts, without white space. */
function rendered(result: ReturnType<typeof plan>): readonly string[] {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  const source = (result.plan as PlannerProducedMongoMigration)
    .renderTypeScript(workspaceMigrationModule.mongo)
    .replace(/\s+/g, '')
    .replace(/,\}/g, '}');
  return source.match(/(?:replace|remove)StoredValue\(\{(?:[^{}]|\{[^{}]*\})*\}\)/g) ?? [];
}

function refused(result: ReturnType<typeof plan>) {
  if (result.kind !== 'failure') throw new Error('Expected the plan to be refused');
  return result.conflicts;
}

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
    expect(rendered(result)).toEqual([
      'replaceStoredValue({collection:"users",field:"level",from:2,to:3})',
    ]);
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
    expect(rendered(result)).toEqual([
      'replaceStoredValue({collection:"users",field:"notes",path:"$[*].status",from:"archived",to:{$literal:"retired"}})',
      'replaceStoredValue({collection:"users",field:"home",path:"$.status",from:"archived",to:{$literal:"retired"}})',
    ]);
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
      ).labels,
    ).toEqual([
      'Replace value "archived" with "retired" in field status of collection users',
      'Update validator on users (changed: status)',
    ]);
  });

  it('leaves a variant discriminator the enum types to the variant change, which asks for --convert', () => {
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

describe('MongoMigrationPlanner, enum values that keep their names and trade or take stored values', () => {
  it('refuses two values that trade places', () => {
    expect(
      refused(
        plan({
          from: users('from', { ACTIVE: 'active', ARCHIVED: 'archived' }),
          to: users('to', { ACTIVE: 'archived', ARCHIVED: 'active' }),
          schema: live,
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot change the stored values of enum "Status": enum values "Status.ACTIVE" and "Status.ARCHIVED" move stored values in a cycle, "active" to "archived" and "archived" to "active", and a rewrite of one would overwrite the other before it is read',
        why: 'The plan rewrites a changed stored value in every document that holds it, one value after another, and no order of the rewrites moves values in a cycle. Make the change in two plans: first give "Status.ACTIVE" a stored value no member stores, such as "prisma_swap" and "Status.ARCHIVED" a stored value no member stores, such as "prisma_swap_", and plan and apply that; then give "Status.ACTIVE" the stored value "archived" and "Status.ARCHIVED" the stored value "active", and plan again.',
      },
    ]);
  });

  it('refuses a chain of stored values', () => {
    expect(
      refused(
        plan({
          from: users('from', { A: 'a', B: 'b' }),
          to: users('to', { A: 'b', B: 'c' }),
          schema: live,
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot change the stored values of enum "Status": enum values "Status.A" and "Status.B" move stored values along a chain, "a" to "b" and "b" to "c", and a rewrite of one would write a value another still has to read',
        why: 'MongoDB applies a migration\'s operations one at a time, without a transaction, and knows that an operation already ran only from the documents, so a rewrite of a value that another rewrite of the same migration writes would act on what that one wrote when the migration runs again after a later operation stops. Make the change in two plans: first give "Status.A" a stored value no member stores, such as "prisma_swap" and "Status.B" the stored value "c", and plan and apply that; then give "Status.A" the stored value "b", and plan again.',
      },
    ]);
  });

  it('refuses a value that another member of the origin holds, which the destination removes', () => {
    expect(
      refused(
        plan({
          from: users('from', { A: 'a', X: 'x' }),
          to: users('to', { A: 'x' }),
          schema: live,
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot change the stored value of enum value "Status.A" from "a" to "x": the origin enum stores "x" as enum value "Status.X"',
        why: 'A changed stored value is rewritten in every document that holds it, so the documents of "Status.A" would hold "x" as the documents of "Status.X" do, and their data would merge. Make the change in two plans: first remove enum value "Status.X", and plan and apply that; then give "Status.A" the stored value "x", and plan again. The first plan asks about the documents that hold "x". If you answer it with --delete Status.X, a required field cannot lose its value: before that plan applies, delete those documents in the database, or set them to "a" there to merge their data with the data of "Status.A" on purpose.',
      },
    ]);
  });

  it('refuses a boolean enum whose values trade places, with the hand-written route', () => {
    const flags = (seed: string, members: Readonly<Record<string, unknown>>) =>
      users(seed, members, {
        codecId: 'mongo/bool@1',
        types: { flag: { codecId: 'mongo/bool@1', valueSet: 'Status', nullable: true } },
      });
    expect(
      refused(
        plan({
          from: flags('from', { YES: true, NO: false }),
          to: flags('to', { YES: false, NO: true }),
          schema: live,
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot change the stored values of enum "Status": enum values "Status.YES" and "Status.NO" move stored values in a cycle, true to false and false to true, and a rewrite of one would overwrite the other before it is read',
        why: 'The plan rewrites a changed stored value in every document that holds it, one value after another, and no order of the rewrites moves values in a cycle. A boolean enum has no third value to move a stored value to, so the change cannot be made in two plans. Write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the stored values of the enum, in one update whose pipeline sets each field that holds the enum to its negation with $not, yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
      },
    ]);
  });
});

describe('MongoMigrationPlanner, an enum value change with no statement that a collection refuses', () => {
  it('is refused in a time-series collection, naming the change and no statement', () => {
    const readings = (seed: string, members: Readonly<Record<string, unknown>>) =>
      users(seed, members, {
        types: { at: { codecId: 'mongo/date@1' }, status: { ...STATUS, nullable: true } },
        collection: { timeField: 'at' },
      });
    expect(
      refused(
        plan({
          from: readings('from', { ACTIVE: 'active', ARCHIVED: 'archived' }),
          to: readings('to', { ACTIVE: 'active', ARCHIVED: 'retired' }),
          schema: [schemaCollection('users', { timeseries: true })],
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot replace enum value "Status.ARCHIVED" inside field "status" in collection "users": it is a time-series collection',
        why: "MongoDB updates the documents of a time-series collection only through its metaField, so the stored value cannot be replaced in the documents. Keep the enum value's stored value in the contract, then run this command again.",
      },
    ]);
  });
});

describe('MongoMigrationPlanner, the routes enum value refusals give, followed', () => {
  const step = (from: Readonly<Record<string, unknown>>, to: Readonly<Record<string, unknown>>) => {
    const result = plan({
      from: users('from', from, { types: { status: { ...STATUS, nullable: true } } }),
      to: users('to', to, { types: { status: { ...STATUS, nullable: true } } }),
      schema: live,
    });
    return { labels: planned(result).labels, dataLoss: planned(result).dataLoss.length };
  };
  const replace = (from: string, to: string) =>
    `Replace value "${from}" with "${to}" in field status of collection users`;

  it('swaps two values through values no member stores', () => {
    const through = { ACTIVE: 'prisma_swap', ARCHIVED: 'prisma_swap_' };
    expect([
      step({ ACTIVE: 'active', ARCHIVED: 'archived' }, through),
      step(through, { ACTIVE: 'archived', ARCHIVED: 'active' }),
    ]).toEqual([
      {
        labels: [replace('active', 'prisma_swap'), replace('archived', 'prisma_swap_')],
        dataLoss: 0,
      },
      {
        labels: [replace('prisma_swap', 'archived'), replace('prisma_swap_', 'active')],
        dataLoss: 0,
      },
    ]);
  });

  it('moves a chain through a value no member stores', () => {
    expect([
      step({ A: 'a', B: 'b' }, { A: 'prisma_swap', B: 'c' }),
      step({ A: 'prisma_swap', B: 'c' }, { A: 'b', B: 'c' }),
    ]).toEqual([
      { labels: [replace('a', 'prisma_swap'), replace('b', 'c')], dataLoss: 0 },
      { labels: [replace('prisma_swap', 'b')], dataLoss: 0 },
    ]);
  });

  it('removes the member whose value the other takes, then gives it that value', () => {
    expect([step({ A: 'a', X: 'x' }, { A: 'a' }), step({ A: 'a' }, { A: 'x' })]).toEqual([
      { labels: ['Remove value "x" from field status of collection users'], dataLoss: 1 },
      { labels: [replace('a', 'x')], dataLoss: 0 },
    ]);
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
