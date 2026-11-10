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
  renameField,
  renameModel,
  schemaCollection,
} from './mongo-statement-fixtures';

const OBJECT_ID: FieldTypeSpec = { codecId: 'mongo/objectId@1' };
const INT: FieldTypeSpec = { codecId: 'mongo/int32@1' };
const STRING: FieldTypeSpec = { codecId: 'mongo/string@1' };
const OPTIONAL_STRING: FieldTypeSpec = { codecId: 'mongo/string@1', nullable: true };

const NOT_A_STATEMENT =
  'No statement (--rename, --delete, --convert, --backfill) covers this change, so the plan does not rewrite the documents. Write a dataTransform in migration.ts, before the validator change, that rewrites them to fit; until they fit, the validator change checks the documents and fails the apply. With db update, plan the change with migration plan instead.';

function users(seed: string, address: Record<string, FieldTypeSpec>) {
  return contract(
    seed,
    {
      User: {
        collection: 'users',
        fields: ['_id', 'email'],
        types: { _id: OBJECT_ID, email: STRING },
        embeds: { addresses: 'addresses' },
      },
      Address: { owner: 'User', fields: Object.keys(address), types: address },
    },
    { users: {} },
  );
}

const live = [schemaCollection('users')];

async function outcome(result: ReturnType<typeof plan>) {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  return {
    operations: (await listedOperations(result.plan as PlannerProducedMongoMigration)).map(
      (operation) => Reflect.get(operation ?? {}, 'label'),
    ),
    dataLoss: result.dataLoss,
    warnings: (result.warnings ?? []).map(({ kind, summary, why }) => ({ kind, summary, why })),
  };
}

function addressStatement(kind: 'convert' | 'backfill', field: string): ResolvedMigrationStatement {
  return { kind, entity: 'field', field: { namespaceId: NS, model: 'Address', field } };
}

describe('MongoMigrationPlanner, a field of an embedded model', () => {
  it('plans no rewrite of the owner documents for a removed field, and warns', async () => {
    expect(
      await outcome(
        plan({
          from: users('from', { street: STRING, city: STRING }),
          to: users('to', { city: STRING }),
          schema: live,
        }),
      ),
    ).toEqual({
      operations: [],
      dataLoss: [],
      warnings: [
        {
          kind: 'documentsNotRewritten',
          why: NOT_A_STATEMENT,
          summary: 'Field "Address.street" of embedded model "Address" is removed',
        },
      ],
    });
  });

  it('plans no cast for a field whose type changes, and warns', async () => {
    expect(
      await outcome(
        plan({
          from: users('from', { zip: INT }),
          to: users('to', { zip: STRING }),
          schema: live,
        }),
      ),
    ).toEqual({
      operations: [],
      dataLoss: [],
      warnings: [
        {
          kind: 'documentsNotRewritten',
          why: NOT_A_STATEMENT,
          summary: 'Field "Address.zip" of embedded model "Address" changes type',
        },
      ],
    });
  });

  it('plans no fill for a new required field or an optional field made required, and warns', async () => {
    expect(
      await outcome(
        plan({
          from: users('from', { city: OPTIONAL_STRING }),
          to: users('to', { city: STRING, country: STRING }),
          schema: live,
        }),
      ),
    ).toEqual({
      operations: [],
      dataLoss: [],
      warnings: [
        {
          kind: 'documentsNotRewritten',
          why: NOT_A_STATEMENT,
          summary: 'Field "Address.city" of embedded model "Address" becomes required',
        },
        {
          kind: 'documentsNotRewritten',
          why: NOT_A_STATEMENT,
          summary: 'Field "Address.country" of embedded model "Address" is new and required',
        },
      ],
    });
  });

  it('refuses a rename, a convert and a backfill of the field', () => {
    const why =
      'Fields of an embedded model are not rewritten in this release. Leave out this statement.';
    expect([
      refusal(
        plan({
          from: users('from', { street: STRING }),
          to: users('to', { road: STRING }),
          schema: live,
          statements: [renameField('Address', 'street', 'Address', 'road')],
        }),
      ),
      refusal(
        plan({
          from: users('from', { zip: STRING }),
          to: users('to', { zip: INT }),
          schema: live,
          statements: [addressStatement('convert', 'zip')],
        }),
      ),
      refusal(
        plan({
          from: users('from', { city: OPTIONAL_STRING }),
          to: users('to', { city: STRING }),
          schema: live,
          statements: [addressStatement('backfill', 'city')],
        }),
      ),
    ]).toEqual([
      [
        {
          kind: 'statementRefused',
          summary:
            'Cannot rename field "Address.street" to "Address.road": model "Address" is embedded in the documents of model "User"',
          why,
        },
      ],
      [
        {
          kind: 'statementRefused',
          summary:
            'Cannot convert field "Address.zip": model "Address" is embedded in the documents of model "User"',
          why,
        },
      ],
      [
        {
          kind: 'statementRefused',
          summary:
            'Cannot backfill field "Address.city": model "Address" is embedded in the documents of model "User"',
          why,
        },
      ],
    ]);
  });

  it('refuses a rename of the embedded model', () => {
    const named = (seed: string, embedded: string) =>
      contract(
        seed,
        {
          User: {
            collection: 'users',
            fields: ['_id', 'email'],
            types: { _id: OBJECT_ID, email: STRING },
            embeds: { addresses: 'addresses' },
          },
          [embedded]: { owner: 'User', fields: ['street'], types: { street: STRING } },
        },
        { users: {} },
      );

    expect(
      refusal(
        plan({
          from: named('from', 'Address'),
          to: named('to', 'Location'),
          schema: live,
          statements: [renameModel('Address', 'Location')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename model "Address" to "Location": model "Address" is embedded in the documents of model "User"',
        why: 'Embedded models are not renamed in this release. Leave out this statement.',
      },
    ]);
  });
});
