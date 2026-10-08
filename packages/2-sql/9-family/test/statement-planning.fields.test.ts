import { notOk, ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import {
  fieldRenameStorageEffect,
  planStatements,
} from '../src/core/migrations/statement-planning';
import {
  ALL_CLASSES,
  contractOf,
  fakeTarget,
  planned,
  rejection,
  renameField,
  renameModel,
} from './statement-fixtures';

const ignoreCase = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

const origin = contractOf({ User: { table: 'User', fields: { id: 'id', name: 'name' } } });
const destination = contractOf({
  User: { table: 'User', fields: { id: 'id', fullName: 'fullName' } },
});

describe('fieldRenameStorageEffect', () => {
  it('is a column rename when the column name changes', () => {
    expect(
      fieldRenameStorageEffect(renameField('User', 'name', 'fullName'), origin, destination),
    ).toEqual(
      ok({
        kind: 'renameColumn',
        table: { namespaceId: 'app', table: 'User' },
        from: 'name',
        to: 'fullName',
      }),
    );
  });

  it('is unchanged when both fields map to the same column', () => {
    const mapped = contractOf({ User: { table: 'User', fields: { fullName: 'name' } } });
    expect(
      fieldRenameStorageEffect(renameField('User', 'name', 'fullName'), origin, mapped),
    ).toEqual(ok({ kind: 'unchanged' }));
  });

  it('is unchanged for a relation field, which has no column', () => {
    const before = contractOf({ User: { table: 'User', fields: { posts: null } } });
    const after = contractOf({ User: { table: 'User', fields: { articles: null } } });
    expect(
      fieldRenameStorageEffect(renameField('User', 'posts', 'articles'), before, after),
    ).toEqual(ok({ kind: 'unchanged' }));
  });
});

describe('fieldRenameStorageEffect, when no effect can be worked out', () => {
  it('reports a field that has a column on one side only', () => {
    const before = contractOf({ User: { table: 'User', fields: { posts: null } } });
    const after = contractOf({ User: { table: 'User', fields: { title: 'title' } } });
    expect(fieldRenameStorageEffect(renameField('User', 'posts', 'title'), before, after)).toEqual(
      notOk({ kind: 'columnOnOneSide' }),
    );
  });
});

describe('planStatements, field renames', () => {
  it('renames the column and reports the statement', () => {
    const statement = renameField('User', 'name', 'fullName');
    expect(
      planned(
        planStatements({
          policy: ALL_CLASSES,
          statements: [statement],
          fromContract: origin,
          contract: destination,
          target: fakeTarget(['app.User'], { 'app.User': ['id', 'name'] }),
        }),
      ),
    ).toEqual({
      calls: ['column app.User.name -> fullName'],
      tableRenames: [],
      columnRenames: [{ namespaceId: 'app', table: 'User', from: 'name', to: 'fullName' }],
      appliedStatements: [
        {
          statement,
          operationIndexes: [0, 1],
        },
      ],
    });
  });

  it('renames the column on the table an earlier statement renamed', () => {
    const before = contractOf({ Profile: { table: 'Profile', fields: { name: 'name' } } });
    const after = contractOf({ User: { table: 'User', fields: { fullName: 'fullName' } } });
    expect(
      planned(
        planStatements({
          policy: ALL_CLASSES,
          statements: [
            renameModel('Profile', 'User'),
            renameField('Profile', 'name', 'fullName', 'User'),
          ],
          fromContract: before,
          contract: after,
          target: fakeTarget(['app.Profile'], { 'app.Profile': ['name'] }),
        }),
      ).calls,
    ).toEqual(['table app.Profile -> User', 'column app.User.name -> fullName']);
  });

  it('applies a relation field rename with no operations', () => {
    const before = contractOf({ User: { table: 'User', fields: { posts: null } } });
    const after = contractOf({ User: { table: 'User', fields: { articles: null } } });
    expect(
      planned(
        planStatements({
          policy: ALL_CLASSES,
          statements: [renameField('User', 'posts', 'articles')],
          fromContract: before,
          contract: after,
          target: fakeTarget(['app.User']),
        }),
      ),
    ).toMatchObject({
      calls: [],
      columnRenames: [],
      appliedStatements: [{ operationIndexes: [] }],
    });
  });

  it('rejects a rename whose column the schema being planned from does not have', () => {
    const statement = renameField('User', 'name', 'fullName');
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [statement],
        fromContract: origin,
        contract: destination,
        target: fakeTarget(['app.User'], { 'app.User': ['id'] }),
      }),
    );
    expect(conflict).toMatchObject({
      kind: 'statementRefused',
      refusedStatement: statement,
      location: { namespaceId: 'app', entityKind: 'table', entityName: 'User', column: 'name' },
    });
    expect(conflict.summary).toContain('has no column "name"');
  });

  it('rejects a rename onto a column the schema being planned from already has', () => {
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [renameField('User', 'name', 'fullName')],
        fromContract: origin,
        contract: destination,
        target: fakeTarget(['app.User'], { 'app.User': ['name', 'fullName'] }),
      }),
    );
    expect(conflict.summary).toContain('already has a column "fullName"');
  });

  it('rejects a rename onto a name the target takes for an existing column of another case', () => {
    const before = contractOf({
      User: { table: 'User', fields: { other: 'other', Name: 'Name' } },
    });
    const after = contractOf({ User: { table: 'User', fields: { NAME: 'NAME', Name: 'Name' } } });
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [renameField('User', 'other', 'NAME')],
        fromContract: before,
        contract: after,
        target: fakeTarget(
          ['app.User'],
          { 'app.User': ['other', 'Name'] },
          ['widening'],
          ignoreCase,
        ),
      }),
    );
    expect(conflict.summary).toContain('already has a column "Name"');
  });

  it('renames a column whose name changes only in case where the target ignores case', () => {
    const before = contractOf({ User: { table: 'User', fields: { name: 'name' } } });
    const after = contractOf({ User: { table: 'User', fields: { Name: 'Name' } } });
    expect(
      planned(
        planStatements({
          policy: ALL_CLASSES,
          statements: [renameField('User', 'name', 'Name')],
          fromContract: before,
          contract: after,
          target: fakeTarget(['app.User'], { 'app.User': ['name'] }, ['widening'], ignoreCase),
        }),
      ).calls,
    ).toEqual(['column app.User.name -> Name']);
  });

  it('rejects a rename on a table the destination stores the model in under another name', () => {
    const statement = renameField('User', 'name', 'fullName');
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [statement],
        fromContract: contractOf({ User: { table: 'users', fields: { name: 'name' } } }),
        contract: contractOf({ User: { table: 'app_users', fields: { fullName: 'fullName' } } }),
        target: fakeTarget(['app.users'], { 'app.users': ['name'] }),
      }),
    );
    expect(conflict).toMatchObject({
      kind: 'statementRefused',
      refusedStatement: statement,
      summary:
        'Cannot rename column "users"."name": the model\'s table changes from "users" to "app_users", and no statement renames the table',
    });
    expect(conflict.why).toContain(
      'With migration plan, rename the table by hand in its own migration first. Change the contract so that only the table name changes, and run prisma contract emit. Run prisma migration new --name <name> --from <hash of the migration the database is at>, add renameTable app.users -> app_users to the operations of its migration.ts, and run node on that migration.ts to write its ops.json. Then change the contract to its final form, emit it, and plan the field rename with --from that migration. With db update, change the contract so that only the table name changes, and run prisma contract emit. Rename the table in the database yourself with RENAME app.users TO app_users, check that prisma db update --dry-run plans no drop of a table or column, and run prisma db update to store that contract. Then emit the final contract and run prisma db update --rename app.User.name:app.User.fullName.',
    );
  });

  it('rejects a field that has a column on one side only', () => {
    const before = contractOf({ User: { table: 'User', fields: { posts: null } } });
    const after = contractOf({ User: { table: 'User', fields: { title: 'title' } } });
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [renameField('User', 'posts', 'title')],
        fromContract: before,
        contract: after,
        target: fakeTarget(['app.User']),
      }),
    );
    expect(conflict.kind).toBe('statementRefused');
    expect(conflict.summary).toContain('column on one side only');
  });

  it('rejects a column rename the policy does not allow', () => {
    const conflict = rejection(
      planStatements({
        policy: { allowedOperationClasses: ['additive'] },
        statements: [renameField('User', 'name', 'fullName')],
        fromContract: origin,
        contract: destination,
        target: fakeTarget(['app.User'], { 'app.User': ['name'] }),
      }),
    );
    expect(conflict).toMatchObject({
      kind: 'statementRefused',
      refusedOperationClass: 'widening',
    });
  });

  it('rejects renaming a column of a table whose control policy is not managed', () => {
    const external = contractOf({
      User: { table: 'User', control: 'external', fields: { fullName: 'fullName' } },
    });
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [renameField('User', 'name', 'fullName')],
        fromContract: origin,
        contract: external,
        target: fakeTarget(['app.User'], { 'app.User': ['name'] }),
      }),
    );
    expect(conflict.summary).toContain('control policy is "external"');
  });
});
