import { describe, expect, it } from 'vitest';
import { contract, type FieldTypeSpec, plan, schemaCollection } from './mongo-statement-fixtures';

const OBJECT_ID: FieldTypeSpec = { codecId: 'mongo/objectId@1' };
const INT: FieldTypeSpec = { codecId: 'mongo/int32@1' };
const STRING: FieldTypeSpec = { codecId: 'mongo/string@1' };

const WHY =
  'This change is not a statement, so the plan does not rewrite the documents. Write a dataTransform in migration.ts, before the validator change, that rewrites them to fit; until they fit, the validator change checks the documents and fails the apply. With db update, plan the change with migration plan instead.';

function users(
  seed: string,
  fields: Record<string, FieldTypeSpec>,
  valueObjects: Record<string, Record<string, FieldTypeSpec>> = {},
) {
  return contract(
    seed,
    {
      User: {
        collection: 'users',
        fields: ['_id', ...Object.keys(fields)],
        types: { _id: OBJECT_ID, ...fields },
      },
    },
    { users: {} },
    valueObjects,
  );
}

function warnings(result: ReturnType<typeof plan>) {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  return (result.warnings ?? []).map(({ kind, summary, why }) => ({ kind, summary, why }));
}

describe('MongoMigrationPlanner, a change the plan does not rewrite the documents for', () => {
  const live = [schemaCollection('users')];

  it('warns when a field of a value object changes type', () => {
    expect(
      warnings(
        plan({
          from: users(
            'from',
            { address: { codecId: '', valueObject: 'Address' } },
            { Address: { zip: INT } },
          ),
          to: users(
            'to',
            { address: { codecId: '', valueObject: 'Address' } },
            { Address: { zip: STRING } },
          ),
          schema: live,
        }),
      ),
    ).toEqual([
      {
        kind: 'documentsNotRewritten',
        summary: 'Field "Address.zip" of a value object changes type',
        why: WHY,
      },
    ]);
  });

  it('warns when a field moves to another value object', () => {
    expect(
      warnings(
        plan({
          from: users(
            'from',
            { address: { codecId: '', valueObject: 'Address' } },
            { Address: { zip: INT }, Location: { zip: INT } },
          ),
          to: users(
            'to',
            { address: { codecId: '', valueObject: 'Location' } },
            { Address: { zip: INT }, Location: { zip: INT } },
          ),
          schema: live,
        }),
      ).map(({ summary }) => summary),
    ).toEqual([
      'Field "User.address" moves from value object "Address" to value object "Location"',
    ]);
  });

  it('warns when a field gains an enum or changes enum', () => {
    expect(
      [
        [STRING, { ...STRING, valueSet: 'Status' }],
        [
          { ...STRING, valueSet: 'Status' },
          { ...STRING, valueSet: 'Stage' },
        ],
      ].map(([before, after]) =>
        warnings(
          plan({
            from: users('from', { status: before ?? STRING }),
            to: users('to', { status: after ?? STRING }),
            schema: live,
          }),
        ).map(({ summary }) => summary),
      ),
    ).toEqual([
      ['Field "User.status" gains enum "Status"'],
      ['Field "User.status" changes from enum "Status" to enum "Stage"'],
    ]);
  });

  it('warns about nothing without an origin contract, or when nothing changes', () => {
    expect([
      warnings(
        plan({
          from: null,
          to: users('to', { status: { ...STRING, valueSet: 'Status' } }),
          schema: live,
        }),
      ),
      warnings(
        plan({
          from: users('from', { status: STRING }),
          to: users('to', { status: STRING }),
          schema: live,
        }),
      ),
    ]).toEqual([[], []]);
  });
});
