import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  contract,
  type FieldTypeSpec,
  NS,
  plan,
  planned,
  renameField,
  schemaCollection,
} from './mongo-statement-fixtures';

const OBJECT_ID: FieldTypeSpec = { codecId: 'mongo/objectId@1' };
const STRING: FieldTypeSpec = { codecId: 'mongo/string@1' };
const OPTIONAL_STRING: FieldTypeSpec = { codecId: 'mongo/string@1', nullable: true };

const ONE_AT_A_TIME =
  "MongoDB applies a migration's operations one at a time, without a transaction, and knows that an operation already ran only from the documents.";

const why = (noun: string, advice: string) =>
  `${ONE_AT_A_TIME} An operation that reads a ${noun} another operation of the same migration writes acts on what that operation wrote: at once when it runs later, and when the migration runs again after a later operation stops. ${advice}`;

const RENAME_ADVICE =
  'Make the change in two migrations: first rename the keys or fields to names nothing else uses and apply that; then rename them to their final names.';

const FILL_ADVICE =
  'Make the change in two migrations: first make the rename and apply it, without the new required field; then add the new field.';

/** Users holding a list of `Address` value objects. */
function addressUsers(seed: string, address: Record<string, FieldTypeSpec>) {
  return contract(
    seed,
    {
      User: {
        collection: 'users',
        fields: ['_id', 'addresses'],
        types: {
          _id: OBJECT_ID,
          addresses: { codecId: '', valueObject: 'Address', many: true },
        },
      },
    },
    { users: {} },
    { Address: address },
  );
}

/** Users whose own fields are `fields`. */
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
    { users: {} },
  );
}

const live = [schemaCollection('users')];

const renameAddress = (from: string, to: string): ResolvedMigrationStatement => ({
  kind: 'rename',
  entity: 'valueObjectField',
  from: { namespaceId: NS, valueObject: 'Address', field: from },
  to: { namespaceId: NS, valueObject: 'Address', field: to },
});

const renameUser = (from: string, to: string) => renameField('User', from, 'User', to);

const renameKeyLabel = (from: string, to: string) =>
  `Rename key "${from}" to "${to}" at path "$[*]" in field addresses of collection users`;

const renameFieldLabel = (from: string, to: string) =>
  `Rename field ${from} to ${to} in collection users`;

function refused(result: ReturnType<typeof plan>) {
  if (result.kind !== 'failure') throw new Error('Expected the plan to be refused');
  return result.conflicts.map(({ kind, summary, why, leaveOut }) => ({
    kind,
    summary,
    why,
    leaveOut,
  }));
}

describe('MongoMigrationPlanner, renames of keys inside a value object that read what another writes', () => {
  it('refuses a chain, in either order of the statements', () => {
    const chain = (statements: readonly ResolvedMigrationStatement[]) =>
      refused(
        plan({
          from: addressUsers('from', { a: STRING, b: STRING }),
          to: addressUsers('to', { b: STRING, c: STRING }),
          schema: live,
          statements,
        }),
      );
    const expected = (first: ResolvedMigrationStatement, second: ResolvedMigrationStatement) => [
      {
        kind: 'statementRefused',
        summary: `Cannot rename value object field "Address.a" to "Address.b": the migration writes a key that another of its operations reads (${renameKeyLabel('a', 'b')}; ${renameKeyLabel('b', 'c')})`,
        why: why('key', RENAME_ADVICE),
        leaveOut: [first, second],
      },
    ];
    expect(chain([renameAddress('a', 'b'), renameAddress('b', 'c')])).toEqual(
      expected(renameAddress('a', 'b'), renameAddress('b', 'c')),
    );
    expect(chain([renameAddress('b', 'c'), renameAddress('a', 'b')])).toEqual(
      expected(renameAddress('a', 'b'), renameAddress('b', 'c')),
    );
  });

  it('refuses a swap', () => {
    expect(
      refused(
        plan({
          from: addressUsers('from', { a: STRING, b: STRING }),
          to: addressUsers('to', { a: STRING, b: STRING }),
          schema: live,
          statements: [renameAddress('a', 'b'), renameAddress('b', 'a')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary: `Cannot rename value object field "Address.a" to "Address.b": the migration writes a key that another of its operations reads (${renameKeyLabel('a', 'b')}; ${renameKeyLabel('b', 'a')})`,
        why: why('key', RENAME_ADVICE),
        leaveOut: [renameAddress('a', 'b'), renameAddress('b', 'a')],
      },
    ]);
  });

  it('plans renames that do not meet', () => {
    expect(
      planned(
        plan({
          from: addressUsers('from', { a: STRING, c: STRING }),
          to: addressUsers('to', { b: STRING, d: STRING }),
          schema: live,
          statements: [renameAddress('a', 'b'), renameAddress('c', 'd')],
        }),
      ).labels,
    ).toEqual([renameKeyLabel('a', 'b'), renameKeyLabel('c', 'd')]);
  });
});

describe('MongoMigrationPlanner, renames of fields that read what another writes', () => {
  it('refuses a chain', () => {
    expect(
      refused(
        plan({
          from: users('from', { a: STRING, b: STRING }),
          to: users('to', { b: STRING, c: STRING }),
          schema: live,
          statements: [renameUser('a', 'b'), renameUser('b', 'c')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary: `Cannot rename field "User.a" to "User.b": the migration writes a field that another of its operations reads (${renameFieldLabel('a', 'b')}; ${renameFieldLabel('b', 'c')})`,
        why: why('field', RENAME_ADVICE),
        leaveOut: [renameUser('a', 'b'), renameUser('b', 'c')],
      },
    ]);
  });

  it('refuses a swap', () => {
    expect(
      refused(
        plan({
          from: users('from', { a: STRING, b: STRING }),
          to: users('to', { a: STRING, b: STRING }),
          schema: live,
          statements: [renameUser('a', 'b'), renameUser('b', 'a')],
        }),
      ).map(({ summary }) => summary),
    ).toEqual([
      `Cannot rename field "User.a" to "User.b": the migration writes a field that another of its operations reads (${renameFieldLabel('a', 'b')}; ${renameFieldLabel('b', 'a')})`,
    ]);
  });

  it('plans renames that do not meet', () => {
    expect(
      planned(
        plan({
          from: users('from', { a: STRING, c: STRING }),
          to: users('to', { b: STRING, d: STRING }),
          schema: live,
          statements: [renameUser('a', 'b'), renameUser('c', 'd')],
        }),
      ).labels,
    ).toEqual([renameFieldLabel('a', 'b'), renameFieldLabel('c', 'd')]);
  });
});

describe('MongoMigrationPlanner, a new required field under the name a rename moves away', () => {
  it('refuses a fill of the key inside a value object', () => {
    expect(
      refused(
        plan({
          from: addressUsers('from', { street: OPTIONAL_STRING }),
          to: addressUsers('to', { line1: OPTIONAL_STRING, street: STRING }),
          schema: live,
          statements: [renameAddress('street', 'line1')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary: `Cannot rename value object field "Address.street" to "Address.line1": the migration writes a key that another of its operations reads (${renameKeyLabel('street', 'line1')}; Fill key "street" at path "$[*]" in field addresses of collection users where it is missing or null)`,
        why: why('key', FILL_ADVICE),
        leaveOut: [renameAddress('street', 'line1')],
      },
    ]);
  });

  it('refuses a backfill of the key inside a value object', () => {
    const backfill: ResolvedMigrationStatement = {
      kind: 'backfill',
      entity: 'valueObjectField',
      field: { namespaceId: NS, valueObject: 'Address', field: 'street' },
    };
    expect(
      refused(
        plan({
          from: addressUsers('from', { street: OPTIONAL_STRING }),
          to: addressUsers('to', { line1: OPTIONAL_STRING, street: STRING }),
          schema: live,
          statements: [renameAddress('street', 'line1'), backfill],
        }),
      ).map(({ leaveOut }) => leaveOut),
    ).toEqual([[renameAddress('street', 'line1'), backfill]]);
  });

  it('refuses a fill of the field', () => {
    expect(
      refused(
        plan({
          from: users('from', { street: OPTIONAL_STRING }),
          to: users('to', { line1: OPTIONAL_STRING, street: STRING }),
          schema: live,
          statements: [renameUser('street', 'line1')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary: `Cannot rename field "User.street" to "User.line1": the migration writes a field that another of its operations reads (${renameFieldLabel('street', 'line1')}; Fill field street in collection users where it is missing or null)`,
        why: why('field', FILL_ADVICE),
        leaveOut: [renameUser('street', 'line1')],
      },
    ]);
  });

  it('plans a rename and a fill of different names', () => {
    expect(
      planned(
        plan({
          from: addressUsers('from', { street: OPTIONAL_STRING }),
          to: addressUsers('to', { line1: OPTIONAL_STRING, city: STRING }),
          schema: live,
          statements: [renameAddress('street', 'line1')],
        }),
      ).labels,
    ).toEqual([
      renameKeyLabel('street', 'line1'),
      'Fill key "city" at path "$[*]" in field addresses of collection users where it is missing or null',
    ]);
  });
});
