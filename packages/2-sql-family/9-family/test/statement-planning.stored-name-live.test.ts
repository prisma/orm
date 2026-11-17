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
  madeTables: [],
  plannedStatements: [],
};
const MADE_APP_USERS = { ...NOTHING, madeTables: [{ namespaceId: 'app', table: 'app_users' }] };

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
    expect(planned(result)).toEqual(MADE_APP_USERS);
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
      madeTables: [{ namespaceId: 'app', table: 'app_users' }],
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
      madeTables: [{ namespaceId: 'app', table: 'app_users' }],
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
      why: 'The table of model "app.User" changes from "users" to "app_users", and the database has both table "users" and table "app_users". The rename may have been half done by hand, or something created table "app_users" before db update ran: then move the rows of table "app_users" into table "users", or drop table "app_users", and run again. Or table "users" was renamed to "app_users" by hand and the name "users" used again for another table: then rename or drop table "users", and run again.',
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
      why: 'The table of model "app.User" changes from "users" to "accounts", and the schema being planned from already has table "accounts", the table of model "app.Account". Without the rename the plan would read the rows of table "accounts" as rows of model "app.User". Make the change in two plans: first remove table "accounts" or give it a name nothing uses, and plan and apply that; then make this change and plan again.',
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
      why: 'The column of field "app.User.email" changes from "email" to "email_address", and table "users" in the database has both column "email" and column "email_address". The rename may have been half done by hand, or something created column "email_address" before db update ran: then move the values of column "email_address" into column "email", or drop column "email_address", and run again. Or column "email" was renamed to "email_address" by hand and the name "email" used again for another column: then rename or drop column "email", and run again.',
      location: { namespaceId: 'app', entityKind: 'table', entityName: 'users', column: 'email' },
    });
  });

  it('records a column at its new name on a table at its new name', () => {
    const result = plan(
      { User: users('users') },
      { User: users('app_users', { email: 'email_address' }) },
      fakeTarget(['app.app_users'], { 'app.app_users': ['id', 'email_address'] }),
    );
    expect(planned(result)).toEqual(MADE_APP_USERS);
    expect(
      result.ok &&
        result.value.origins.originColumn({ namespaceId: 'app', table: 'users' }, 'email_address'),
    ).toBe('email');
  });
});
