import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  contract,
  type FieldTypeSpec,
  NS,
  plan,
  planned,
  renameField,
  renameModel,
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
  return result.conflicts.map(({ kind, summary, why, refusedStatement, leaveOut }) => ({
    kind,
    summary,
    why,
    refusedStatement,
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
    const expected = [
      {
        kind: 'statementRefused',
        summary: `Cannot rename value object field "Address.a" to "Address.b": the migration writes a key that another of its operations reads (${renameKeyLabel('a', 'b')}; ${renameKeyLabel('b', 'c')})`,
        why: why('key', RENAME_ADVICE),
        refusedStatement: renameAddress('a', 'b'),
        leaveOut: undefined,
      },
    ];
    expect(chain([renameAddress('a', 'b'), renameAddress('b', 'c')])).toEqual(expected);
    expect(chain([renameAddress('b', 'c'), renameAddress('a', 'b')])).toEqual(expected);
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
        refusedStatement: renameAddress('a', 'b'),
        leaveOut: undefined,
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
        refusedStatement: renameUser('a', 'b'),
        leaveOut: undefined,
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
        refusedStatement: renameAddress('street', 'line1'),
        leaveOut: undefined,
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
      ).map(({ refusedStatement, leaveOut }) => ({ refusedStatement, leaveOut })),
    ).toEqual([{ refusedStatement: renameAddress('street', 'line1'), leaveOut: undefined }]);
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
        refusedStatement: renameUser('street', 'line1'),
        leaveOut: undefined,
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

describe('MongoMigrationPlanner, a new required field under a stored name a rename moves away', () => {
  it('refuses a fill of the field', () => {
    const named = (
      seed: string,
      fields: Record<string, FieldTypeSpec>,
      storedAs: Record<string, string>,
    ) =>
      contract(
        seed,
        {
          User: {
            collection: 'users',
            fields: ['_id', ...Object.keys(fields)],
            types: { _id: OBJECT_ID, ...fields },
            storedAs,
          },
        },
        { users: {} },
      );
    expect(
      refused(
        plan({
          from: named('from', { name: STRING }, { name: 'nm' }),
          to: named('to', { fullName: STRING, code: STRING }, { fullName: 'fn', code: 'nm' }),
          schema: live,
          statements: [renameUser('name', 'fullName')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary: `Cannot rename field "User.name" to "User.fullName": the migration writes a field that another of its operations reads (${renameFieldLabel('nm', 'fn')}; Fill field nm in collection users where it is missing or null)`,
        why: why('field', FILL_ADVICE),
        refusedStatement: renameUser('name', 'fullName'),
        leaveOut: undefined,
      },
    ]);
  });
});

const REMOVE_ADVICE = (noun: string) =>
  `Make the change in two migrations: first remove the ${noun} whose name the rename takes and apply that; then make the rename.`;

describe('MongoMigrationPlanner, a rename onto a name the origin also stores', () => {
  it('removes the field the origin stores under that name, and refuses the plan', () => {
    expect(
      refused(
        plan({
          from: users('from', { a: OPTIONAL_STRING, b: OPTIONAL_STRING }),
          to: users('to', { a: OPTIONAL_STRING }),
          schema: live,
          statements: [renameUser('b', 'a')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary: `Cannot rename field "User.b" to "User.a": the migration writes a field that another of its operations reads (${renameFieldLabel('b', 'a')}; Remove field a from collection users)`,
        why: why('field', REMOVE_ADVICE('field')),
        refusedStatement: renameUser('b', 'a'),
        leaveOut: undefined,
      },
    ]);
  });

  it("names a removed field of a renamed model through the model's new name, as the question does", () => {
    const people = contract(
      'to',
      {
        Person: {
          collection: 'users',
          fields: ['_id', 'a', 'c'],
          types: { _id: OBJECT_ID, a: OPTIONAL_STRING, c: OPTIONAL_STRING },
        },
      },
      { users: {} },
    );
    expect(
      refused(
        plan({
          from: users('from', { a: OPTIONAL_STRING, b: OPTIONAL_STRING }),
          to: people,
          schema: live,
          statements: [renameModel('User', 'Person'), renameField('User', 'b', 'Person', 'a')],
        }),
      ).map(({ why: text }) => text?.slice(0, text.indexOf(ONE_AT_A_TIME))),
    ).toEqual([
      'The plan holds changes that no --rename or --convert statement carries: field "Person.a", which the plan removes. To keep their data, plan again with: --rename Person.a:Person.c. ',
    ]);
  });

  it('names the removal no statement answers when the destination has a field it can be renamed to', () => {
    expect(
      refused(
        plan({
          from: users('from', { a: OPTIONAL_STRING, b: OPTIONAL_STRING }),
          to: users('to', { a: OPTIONAL_STRING, c: OPTIONAL_STRING }),
          schema: live,
          statements: [renameUser('b', 'a')],
        }),
      ).map(({ why: text }) => text),
    ).toEqual([
      `The plan holds changes that no --rename or --convert statement carries: field "User.a", which the plan removes. To keep their data, plan again with: --rename User.a:User.c. ${ONE_AT_A_TIME} An operation that reads a field another operation of the same migration writes acts on what that operation wrote: at once when it runs later, and when the migration runs again after a later operation stops. If every answer is --delete, the plan stays as it is: m${REMOVE_ADVICE('field').slice(1)}`,
    ]);
  });

  it('offers the only new enum member and value object field for their removals, as the questions do', () => {
    const STATUS: FieldTypeSpec = { codecId: 'mongo/string@1', valueSet: 'Status', nullable: true };
    const HOME: FieldTypeSpec = { codecId: '', valueObject: 'Address', nullable: true };
    const withStatus = (
      seed: string,
      fields: Record<string, FieldTypeSpec>,
      address: Record<string, FieldTypeSpec>,
      members: Record<string, string>,
    ) =>
      contract(
        seed,
        {
          User: {
            collection: 'users',
            fields: ['_id', ...Object.keys(fields), 'status', 'home'],
            types: { _id: OBJECT_ID, ...fields, status: STATUS, home: HOME },
          },
        },
        { users: {} },
        { Address: address },
        { Status: { members } },
      );
    const why = refused(
      plan({
        from: withStatus(
          'from',
          { a: OPTIONAL_STRING, b: OPTIONAL_STRING },
          { line1: OPTIONAL_STRING },
          { ACTIVE: 'active', ARCHIVED: 'archived' },
        ),
        to: withStatus(
          'to',
          { a: OPTIONAL_STRING, c: OPTIONAL_STRING },
          { street: OPTIONAL_STRING },
          { ACTIVE: 'active', RETIRED: 'retired' },
        ),
        schema: live,
        statements: [renameUser('b', 'a')],
      }),
    ).map(({ why: text }) => text?.slice(0, text.indexOf(ONE_AT_A_TIME)));
    expect(why).toEqual([
      'The plan holds changes that no --rename or --convert statement carries: field "User.a", which the plan removes; value object field "Address.line1", which the plan removes; enum value "Status.ARCHIVED", which the plan removes from the data. To keep their data, plan again with: --rename User.a:User.c; --rename Address.line1:Address.street; --rename Status.ARCHIVED:Status.RETIRED. ',
    ]);
  });

  describe('when a variant stores that name itself', () => {
    const tasks = (
      seed: string,
      base: Record<string, FieldTypeSpec>,
      bug: Record<string, FieldTypeSpec>,
      storedAs: { readonly base?: Record<string, string>; readonly bug?: Record<string, string> },
    ) =>
      contract(
        seed,
        {
          Task: {
            collection: 'tasks',
            fields: ['_id', 'type', ...Object.keys(base)],
            types: { _id: OBJECT_ID, ...base },
            ...(storedAs.base === undefined ? {} : { storedAs: storedAs.base }),
            discriminator: 'type',
            variants: { Bug: 'bug', Epic: 'epic' },
          },
          Bug: {
            collection: 'tasks',
            fields: Object.keys(bug),
            types: bug,
            ...(storedAs.bug === undefined ? {} : { storedAs: storedAs.bug }),
            base: 'Task',
          },
          Epic: { collection: 'tasks', fields: [], base: 'Task' },
        },
        { tasks: {} },
      );
    const renameTask = renameField('Task', 'b', 'Task', 'a');

    it("removes the variant's field, and refuses a base field renamed onto its name", () => {
      expect(
        refused(
          plan({
            from: tasks('from', { b: OPTIONAL_STRING }, { a: OPTIONAL_STRING }, {}),
            to: tasks('to', { a: OPTIONAL_STRING }, {}, {}),
            schema: [schemaCollection('tasks')],
            statements: [renameTask],
          }),
        ),
      ).toEqual([
        {
          kind: 'statementRefused',
          summary:
            'Cannot rename field "Task.b" to "Task.a": the migration writes a field that another of its operations reads (Rename field b to a in collection tasks; Remove field a from collection tasks in documents whose type is "bug")',
          why: why('field', REMOVE_ADVICE('field')),
          refusedStatement: renameTask,
          leaveOut: undefined,
        },
      ]);
    });

    it("removes the variant's field stored under the name the rename takes through @map", () => {
      expect(
        refused(
          plan({
            from: tasks(
              'from',
              { b: OPTIONAL_STRING },
              { c: OPTIONAL_STRING },
              { base: { b: 'sb' }, bug: { c: 'sa' } },
            ),
            to: tasks('to', { a: OPTIONAL_STRING }, {}, { base: { a: 'sa' } }),
            schema: [schemaCollection('tasks')],
            statements: [renameTask],
          }),
        ),
      ).toEqual([
        {
          kind: 'statementRefused',
          summary:
            'Cannot rename field "Task.b" to "Task.a": the migration writes a field that another of its operations reads (Rename field sb to sa in collection tasks; Remove field sa from collection tasks in documents whose type is "bug")',
          why: why('field', REMOVE_ADVICE('field')),
          refusedStatement: renameTask,
          leaveOut: undefined,
        },
      ]);
    });
  });

  it('removes the key a value object stores under that name, and refuses the plan', () => {
    expect(
      refused(
        plan({
          from: addressUsers('from', { a: OPTIONAL_STRING, b: OPTIONAL_STRING }),
          to: addressUsers('to', { a: OPTIONAL_STRING }),
          schema: live,
          statements: [renameAddress('b', 'a')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary: `Cannot rename value object field "Address.b" to "Address.a": the migration writes a key that another of its operations reads (${renameKeyLabel('b', 'a')}; Remove key "a" at path "$[*]" in field addresses of collection users)`,
        why: why('key', REMOVE_ADVICE('key')),
        refusedStatement: renameAddress('b', 'a'),
        leaveOut: undefined,
      },
    ]);
  });
});
