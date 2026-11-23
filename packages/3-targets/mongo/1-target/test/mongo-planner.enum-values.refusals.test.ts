import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  type CollectionSpec,
  contract,
  type EnumSpec,
  type FieldTypeSpec,
  type ModelSpec,
  NS,
  plan,
  refusal,
  schemaCollection,
} from './mongo-statement-fixtures';

const OBJECT_ID: FieldTypeSpec = { codecId: 'mongo/objectId@1' };
const STATUS: FieldTypeSpec = { codecId: 'mongo/string@1', valueSet: 'Status' };

const renameValue = (from: string, to: string): ResolvedMigrationStatement => ({
  kind: 'rename',
  entity: 'enumValue',
  from: { namespaceId: NS, enum: 'Status', member: from },
  to: { namespaceId: NS, enum: 'Status', member: to },
});

function statuses(members: Readonly<Record<string, unknown>>, codecId?: string): EnumSpec {
  return { members, ...(codecId === undefined ? {} : { codecId }) };
}

const BEFORE = statuses({ ACTIVE: 'active', ARCHIVED: 'archived' });
const RENAMED = statuses({ ACTIVE: 'active', RETIRED: 'retired' });
const REMOVED = statuses({ ACTIVE: 'active' });

/** Users with an optional `status` and a list `tags`, both typed by `Status`. */
function users(
  seed: string,
  status: EnumSpec,
  types: Readonly<Record<string, FieldTypeSpec>> = {
    status: { ...STATUS, nullable: true },
    tags: { ...STATUS, many: true },
  },
  collection: CollectionSpec = {},
  models: Readonly<Record<string, ModelSpec>> = {},
  valueObjects: Readonly<Record<string, Readonly<Record<string, FieldTypeSpec>>>> = {},
) {
  return contract(
    seed,
    {
      User: {
        collection: 'users',
        fields: ['_id', ...Object.keys(types)],
        types: { _id: OBJECT_ID, ...types },
      },
      ...models,
    },
    { users: collection },
    valueObjects,
    { Status: status },
  );
}

const live = [schemaCollection('users')];

const OVERLAP_WHY = (advice: string) =>
  `MongoDB applies a migration's operations one at a time, without a transaction, and knows that an operation already ran only from the documents. An operation that reads a value another operation of the same migration writes acts on what that operation wrote: at once when it runs later, and when the migration runs again after a later operation stops. ${advice}`;

const ENUM_TWO_MIGRATIONS =
  'Make the change as two changes to the contract, and apply the first, by a migration or by db update, before you make the second: first move every value they swap or chain to a stored value the enum does not use; then move them to their final values.';

const NO_THIRD_BOOLEAN =
  'A boolean enum has no third value to move a stored value to, so the change cannot be split into two steps.';

const SWAP_FLAG =
  'db.getCollection("users").updateMany({ "flag": { $type: "bool" } }, [{ $set: { "flag": { $not: ["$flag"] } } }])';

/** The replacements of the plan's fields `status` and `tags`, as a refusal lists them. */
const replacementsOf = (...moves: readonly (readonly [string, string])[]) =>
  moves
    .flatMap(([from, to]) =>
      ['status', 'tags'].map(
        (field) => `Replace value "${from}" with "${to}" in field ${field} of collection users`,
      ),
    )
    .join('; ');

describe('MongoMigrationPlanner, enum value refusals', () => {
  it('refuses an enum whose values are objects', () => {
    const result = plan({
      from: users('from', statuses({ A: { x: 1 }, B: { x: 2 } }, 'mongo/document@1')),
      to: users('to', statuses({ A: { x: 1 } }, 'mongo/document@1')),
      schema: live,
    });
    expect(refusal(result)).toEqual([
      {
        kind: 'fieldRemovalRefused',
        summary:
          'Cannot remove enum value "Status.B": its stored value {"x":2} is not a string, a number or a boolean',
        why: "The plan matches stored enum values by equality, and MongoDB's equality on an object depends on the order of its keys and on a list matches lists that contain it, so the plan cannot change the stored values of this enum; keep the enum value in the contract.",
      },
    ]);
  });

  it('refuses a rename that merges two values', () => {
    const result = plan({
      from: users('from', BEFORE),
      to: users('to', statuses({ ACTIVE: 'active', RETIRED: 'active' })),
      schema: live,
      statements: [renameValue('ARCHIVED', 'RETIRED')],
    });
    expect(refusal(result).map(({ summary }) => summary)).toEqual([
      'Cannot rename enum value "Status.ARCHIVED" to "Status.RETIRED": the origin enum already stores "active", as enum value "Status.ACTIVE"',
    ]);
  });

  it('refuses renames that move values in a cycle', () => {
    const result = plan({
      from: users('from', statuses({ A: 'a', B: 'b' })),
      to: users('to', statuses({ C: 'b', D: 'a' })),
      schema: live,
      statements: [renameValue('A', 'C'), renameValue('B', 'D')],
    });
    expect(refusal(result)).toEqual([
      {
        kind: 'statementRefused',
        summary: `Cannot rename enum value "Status.A" to "Status.C": the migration writes a value that another of its operations reads (${replacementsOf(['a', 'b'], ['b', 'a'])})`,
        why: OVERLAP_WHY(ENUM_TWO_MIGRATIONS),
      },
    ]);
  });

  it('refuses renames that move values along a chain', () => {
    const result = plan({
      from: users('from', statuses({ A: 'a', B: 'b' })),
      to: users('to', statuses({ B: 'b', C: 'c' })),
      schema: live,
      statements: [renameValue('A', 'B'), renameValue('B', 'C')],
    });
    if (result.kind !== 'failure') throw new Error('Expected the plan to be refused');
    expect(
      result.conflicts.map(({ summary, refusedStatement, leaveOut }) => ({
        summary,
        refusedStatement,
        leaveOut,
      })),
    ).toEqual([
      {
        summary: `Cannot rename enum value "Status.A" to "Status.B": the migration writes a value that another of its operations reads (${replacementsOf(['a', 'b'], ['b', 'c'])})`,
        refusedStatement: renameValue('A', 'B'),
        leaveOut: undefined,
      },
    ]);
  });

  it('refuses renames that swap the values of a boolean enum, with the route through plain booleans', () => {
    const flags = (seed: string, members: Readonly<Record<string, unknown>>) =>
      users(seed, statuses(members, 'mongo/bool@1'), {
        flag: { codecId: 'mongo/bool@1', valueSet: 'Status' },
      });
    const result = plan({
      from: flags('from', { YES: true, NO: false }),
      to: flags('to', { ON: false, OFF: true }),
      schema: live,
      statements: [renameValue('YES', 'ON'), renameValue('NO', 'OFF')],
    });
    expect(refusal(result).map(({ why }) => why)).toEqual([
      OVERLAP_WHY(
        `${NO_THIRD_BOOLEAN} Make it in three steps instead, without the statements that rename values of this enum: first remove the enum and type the fields that hold it as plain booleans, and apply that; then swap their values, touching only boolean values so that missing and null values stay as they are, with these updates: ${SWAP_FLAG}; then add the enum back with its new stored values, type the fields by it again, and apply that. With migration plan, make the second step a migration of its own, so that every database that applies the migrations swaps the values: run prisma migration new, and in the operations of the migration.ts it writes, add a dataTransform whose run makes each of these updates; then run that migration.ts to emit its ops.json, and apply it with db migrate. With db update, run the updates in mongosh.`,
      ),
    ]);
  });

  it('refuses an enum whose values are lists', () => {
    const result = plan({
      from: users('from', statuses({ A: ['a'], B: ['b'] }, 'mongo/array@1')),
      to: users('to', statuses({ A: ['a'] }, 'mongo/array@1')),
      schema: live,
    });
    expect(refusal(result).map(({ summary }) => summary)).toEqual([
      'Cannot remove enum value "Status.B": its stored value ["b"] is not a string, a number or a boolean',
    ]);
  });

  it('refuses a removal in a time-series collection', () => {
    const result = plan({
      from: users('from', BEFORE),
      to: users('to', REMOVED),
      schema: [schemaCollection('users', { timeseries: true })],
    });
    expect(refusal(result).map(({ summary }) => summary)).toEqual([
      'Cannot remove enum value "Status.ARCHIVED" inside field "status" from collection "users": it is a time-series collection',
      'Cannot remove enum value "Status.ARCHIVED" inside field "tags" from collection "users": it is a time-series collection',
    ]);
  });

  it('refuses a removal in a collection another root model shares with no discriminator and stores the field untyped by the enum', () => {
    const shared = (seed: string, status: EnumSpec) =>
      users(
        seed,
        status,
        undefined,
        {},
        {
          Guest: {
            collection: 'users',
            fields: ['_id', 'status'],
            types: { _id: OBJECT_ID, status: { codecId: 'mongo/string@1', nullable: true } },
          },
        },
      );
    const result = plan({ from: shared('from', BEFORE), to: shared('to', REMOVED), schema: live });
    expect(refusal(result).map(({ summary }) => summary)[0]).toBe(
      'Cannot remove enum value "Status.ARCHIVED" inside field "status" of model "User" from collection "users": model "Guest" stores it in the same collection',
    );
  });

  it('refuses a rename in a time-series collection', () => {
    const result = plan({
      from: users('from', BEFORE),
      to: users('to', RENAMED),
      schema: [schemaCollection('users', { timeseries: true })],
      statements: [renameValue('ARCHIVED', 'RETIRED')],
    });
    expect(refusal(result).map(({ summary }) => summary)).toEqual([
      'Cannot replace enum value "Status.ARCHIVED" inside field "status" in collection "users": it is a time-series collection',
      'Cannot replace enum value "Status.ARCHIVED" inside field "tags" in collection "users": it is a time-series collection',
    ]);
  });

  it('refuses a rename in a collection another root model shares with no discriminator and stores the field untyped by the enum', () => {
    const shared = (seed: string, status: EnumSpec) =>
      users(
        seed,
        status,
        undefined,
        {},
        {
          Guest: {
            collection: 'users',
            fields: ['_id', 'status'],
            types: { _id: OBJECT_ID, status: { codecId: 'mongo/string@1', nullable: true } },
          },
        },
      );
    const result = plan({
      from: shared('from', BEFORE),
      to: shared('to', RENAMED),
      schema: live,
      statements: [renameValue('ARCHIVED', 'RETIRED')],
    });
    expect(refusal(result).map(({ summary }) => summary)[0]).toBe(
      'Cannot replace enum value "Status.ARCHIVED" inside field "status" of model "User" in collection "users": model "Guest" stores it in the same collection',
    );
  });

  it('refuses a rename in a collection whose control policy is not managed', () => {
    const result = plan({
      from: users('from', BEFORE, undefined, { control: 'external' }),
      to: users('to', RENAMED, undefined, { control: 'external' }),
      schema: live,
      statements: [renameValue('ARCHIVED', 'RETIRED')],
    });
    expect(refusal(result).map(({ summary }) => summary)).toEqual([
      'Cannot rename enum value "Status.ARCHIVED" to "Status.RETIRED": collection "users" has control policy "external"',
    ]);
  });
});
