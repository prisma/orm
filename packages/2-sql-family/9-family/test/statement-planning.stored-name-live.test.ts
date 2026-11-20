import { describe, expect, it } from 'vitest';
import { planStatements } from '../src/core/migrations/statement-planning';
import {
  ALL_CLASSES,
  contractOf,
  fakeTarget,
  type ModelSpec,
  planned,
  rejection,
  renameField,
} from './statement-fixtures';

const NOTHING = {
  calls: [],
  tableRenames: [],
  columnRenames: [],
  alreadyRenamedTables: [],
  plannedStatements: [],
};
const ALREADY_RENAMED_APP_USERS = {
  ...NOTHING,
  alreadyRenamedTables: [{ namespaceId: 'app', table: 'app_users' }],
};

function plan(
  origin: Record<string, ModelSpec>,
  destination: Record<string, ModelSpec>,
  target: ReturnType<typeof fakeTarget>,
  statements: Parameters<typeof planStatements>[0]['statements'] = [],
) {
  return planStatements({
    policy: ALL_CLASSES,
    statements,
    fromContract: contractOf(origin),
    contract: contractOf(destination),
    target,
  });
}

const users = (table: string, fields: Record<string, string> = { email: 'email' }): ModelSpec => ({
  table,
  fields: { id: 'id', ...fields },
});
const originTable = (table: string) => (result: ReturnType<typeof plan>) =>
  result.ok && result.value.origins.originTable({ namespaceId: 'app', table });

describe('planStatements against a database whose table already has its new name', () => {
  it('plans no operation and records that the origin table is at the new name', () => {
    const result = plan(
      { User: users('users') },
      { User: users('app_users') },
      fakeTarget(['app.app_users'], { 'app.app_users': ['id', 'email'] }),
    );
    expect(planned(result)).toEqual(ALREADY_RENAMED_APP_USERS);
    expect(originTable('app_users')(result)).toEqual({ namespaceId: 'app', table: 'users' });
  });

  it('renames the column of a field whose @map changes on the table at its new name', () => {
    const result = plan(
      { User: users('users') },
      { User: users('app_users', { email: 'email_address' }) },
      fakeTarget(['app.app_users'], { 'app.app_users': ['id', 'email'] }),
    );
    expect(planned(result)).toEqual({
      calls: ['column app.app_users.email -> email_address'],
      tableRenames: [],
      columnRenames: [
        { namespaceId: 'app', table: 'app_users', from: 'email', to: 'email_address' },
      ],
      alreadyRenamedTables: [{ namespaceId: 'app', table: 'app_users' }],
      plannedStatements: [],
    });
    expect(
      result.ok &&
        result.value.origins.originColumn({ namespaceId: 'app', table: 'users' }, 'email_address'),
    ).toBe('email');
  });

  it('plans a field rename statement on the table at its new name', () => {
    const statement = renameField('User', 'email', 'contact');
    expect(
      planned(
        plan(
          { User: users('users') },
          { User: users('app_users', { contact: 'contact' }) },
          fakeTarget(['app.app_users'], { 'app.app_users': ['id', 'email'] }),
          [statement],
        ),
      ),
    ).toEqual({
      calls: ['column app.app_users.email -> contact'],
      tableRenames: [],
      columnRenames: [{ namespaceId: 'app', table: 'app_users', from: 'email', to: 'contact' }],
      alreadyRenamedTables: [{ namespaceId: 'app', table: 'app_users' }],
      plannedStatements: [{ statement, operations: { kind: 'planned', operationIndexes: [0, 1] } }],
    });
  });

  it('plans nothing and records nothing when the database has neither name', () => {
    const result = plan(
      { User: users('users') },
      { User: users('app_users') },
      fakeTarget(['app.other']),
    );
    expect(planned(result)).toEqual(NOTHING);
    expect(originTable('app_users')(result)).toEqual({ namespaceId: 'app', table: 'app_users' });
  });

  it('refuses a rename when the database has both names, naming no statement', () => {
    expect(
      rejection(
        plan(
          { User: users('users') },
          { User: users('app_users') },
          fakeTarget(['app.users', 'app.app_users']),
        ),
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary: 'Cannot rename table "users" to "app_users": the database has both tables',
      why: 'The table of model "app.User" changes from "users" to "app_users", and the database has both table "users" and table "app_users". One of two things happened, and each has its own fix. If the rename was half done by hand, or something created table "app_users" before db update ran, table "users" holds the rows of model "app.User": move into table "users" the rows of table "app_users" that it does not already hold, and where both tables hold a row with the same key, keep the version you want in table "users"; then drop table "app_users", and run again. If table "users" was renamed to "app_users" by hand and the name "users" then used for another table, table "app_users" holds the rows of model "app.User": drop table "users", and run again; to keep the rows of that other table, first move them into a table the contract has, since db update drops every table the contract does not have.',
      location: { namespaceId: 'app', entityKind: 'table', entityName: 'users' },
    });
  });

  it('refuses a rename onto the table of an origin model when the old table is missing', () => {
    expect(
      rejection(
        plan(
          { User: users('users'), Account: { table: 'accounts', fields: { id: 'id' } } },
          { User: users('accounts') },
          fakeTarget(['app.accounts']),
        ),
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot rename table "users" to "accounts": the schema being planned from already has a table "accounts"',
      why: 'The table of model "app.User" changes from "users" to "accounts", and the schema being planned from already has table "accounts", the table of model "app.Account". Without the rename the plan would read the rows of table "accounts" as rows of model "app.User". Make the change in two plans: first remove model "app.Account", or keep it and change its table to a name nothing uses, such as "prisma_swap_accounts", and plan and apply that; then make this change and plan again.',
      location: { namespaceId: 'app', entityKind: 'table', entityName: 'users' },
    });
  });
});

describe('planStatements against a database whose column already has its new name', () => {
  const usersTable = (columns: readonly string[]) =>
    fakeTarget(['app.users'], { 'app.users': ['id', ...columns] });

  it('plans no operation and records that the origin column is at the new name', () => {
    const result = plan(
      { User: users('users') },
      { User: users('users', { email: 'email_address' }) },
      usersTable(['email_address']),
    );
    expect(planned(result)).toEqual(NOTHING);
    expect(
      result.ok &&
        result.value.origins.originColumn({ namespaceId: 'app', table: 'users' }, 'email_address'),
    ).toBe('email');
  });

  it('plans nothing when the table has neither column', () => {
    const result = plan(
      { User: users('users') },
      { User: users('users', { email: 'email_address' }) },
      usersTable([]),
    );
    expect(planned(result)).toEqual(NOTHING);
    expect(
      result.ok &&
        result.value.origins.originColumn({ namespaceId: 'app', table: 'users' }, 'email_address'),
    ).toBe('email_address');
  });

  it('refuses a rename when the table has both columns, naming no statement', () => {
    expect(
      rejection(
        plan(
          { User: users('users') },
          { User: users('users', { email: 'email_address' }) },
          usersTable(['email', 'email_address']),
        ),
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot rename column "users"."email" to "email_address": the database has both columns',
      why: 'The column of field "app.User.email" changes from "email" to "email_address", and table "users" in the database has both column "email" and column "email_address". One of two things happened, and each has its own fix. If the rename was half done by hand, or something created column "email_address" before db update ran, column "email" holds the values of field "app.User.email": copy into column "email" the value of column "email_address" in each row where column "email_address" holds one and column "email" holds none, and where both hold a value, keep the one you want in column "email"; then drop column "email_address", and run again. If column "email" was renamed to "email_address" by hand and the name "email" then used for another column, column "email_address" holds the values of field "app.User.email": drop column "email", and run again; to keep the values of that other column, first move them into a column the contract has, since db update drops every column the contract does not have.',
      location: { namespaceId: 'app', entityKind: 'table', entityName: 'users', column: 'email' },
    });
  });

  it('records a column at its new name on a table at its new name', () => {
    const result = plan(
      { User: users('users') },
      { User: users('app_users', { email: 'email_address' }) },
      fakeTarget(['app.app_users'], { 'app.app_users': ['id', 'email_address'] }),
    );
    expect(planned(result)).toEqual(ALREADY_RENAMED_APP_USERS);
    expect(
      result.ok &&
        result.value.origins.originColumn({ namespaceId: 'app', table: 'users' }, 'email_address'),
    ).toBe('email');
  });
});
