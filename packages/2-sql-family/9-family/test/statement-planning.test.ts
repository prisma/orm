import { asNamespaceId } from '@internal/contract/types';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import {
  appliedStatementsInOrder,
  fieldStatementColumns,
  modelRenameStorageEffect,
  planStatements,
} from '../src/core/migrations/statement-planning';
import {
  ALL_CLASSES,
  backfillField,
  contractOf,
  convertField,
  fakeTarget,
  planned,
  rejection,
  renameModel,
} from './statement-fixtures';

const ignoringCase = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

describe('modelRenameStorageEffect', () => {
  it('is unchanged when both models map to the same table', () => {
    const origin = contractOf({ Profile: { table: 'profile' } });
    const destination = contractOf({ User: { table: 'profile' } });
    const statement = renameModel('Profile', 'User');
    expect(modelRenameStorageEffect(statement, origin, destination)).toEqual(
      ok({ kind: 'unchanged' }),
    );
  });

  it('is a table rename when the table name changes', () => {
    const origin = contractOf({ Profile: { table: 'Profile' } });
    const destination = contractOf({ User: { table: 'User' } });
    expect(modelRenameStorageEffect(renameModel('Profile', 'User'), origin, destination)).toEqual(
      ok({ kind: 'renameTable', rename: { namespaceId: 'app', from: 'Profile', to: 'User' } }),
    );
  });

  it('is a namespace move when the namespace changes', () => {
    const origin = contractOf({ User: { table: 'User', namespace: 'auth' } });
    const destination = contractOf({ User: { table: 'User', namespace: 'billing' } });
    expect(
      modelRenameStorageEffect(renameModel('User', 'User', 'auth', 'billing'), origin, destination),
    ).toEqual(
      ok({
        kind: 'moveNamespace',
        from: { namespaceId: 'auth', table: 'User' },
        to: { namespaceId: 'billing', table: 'User' },
      }),
    );
  });
});

describe('fieldStatementColumns', () => {
  it('names the column of each convert and backfill statement as the destination stores it, and the field as the statement names it', () => {
    const destination = contractOf({
      User: { table: 'user', fields: { id: 'id', years: 'age_years', email: 'email' } },
      Ledger: { table: 'ledger', namespace: 'billing', fields: { total: 'total' } },
    });
    expect(
      fieldStatementColumns(
        [
          renameModel('Profile', 'User'),
          convertField('User', 'years'),
          backfillField('User', 'email'),
          backfillField('Ledger', 'total', 'billing'),
        ],
        destination,
      ),
    ).toEqual({
      convert: [
        {
          namespaceId: 'app',
          table: 'user',
          column: 'age_years',
          field: convertField('User', 'years').field,
          text: 'app.User.years',
        },
      ],
      backfill: [
        {
          namespaceId: 'app',
          table: 'user',
          column: 'email',
          field: backfillField('User', 'email').field,
          text: 'app.User.email',
        },
        {
          namespaceId: 'billing',
          table: 'ledger',
          column: 'total',
          field: backfillField('Ledger', 'total', 'billing').field,
          text: 'billing.Ledger.total',
        },
      ],
    });
  });
});

describe('appliedStatementsInOrder', () => {
  it('lists every statement in the order given, a convert or backfill with no operations yet', () => {
    const rename = renameModel('Profile', 'User');
    const convert = convertField('User', 'years');
    const backfill = backfillField('User', 'email');
    expect(
      appliedStatementsInOrder(
        [convert, rename, backfill],
        [{ statement: rename, operations: { kind: 'planned', operationIndexes: [0, 1] } }],
        () => [9],
      ),
    ).toEqual([
      { statement: convert, operationIndexes: [] },
      { statement: rename, operationIndexes: [0, 1] },
      { statement: backfill, operationIndexes: [] },
    ]);
  });

  it('gives a statement planned with the diff the operations the target places for it', () => {
    const rename = renameModel('Profile', 'User');
    const enumValueRename = {
      kind: 'rename',
      entity: 'enumValue',
      from: { namespaceId: asNamespaceId('app'), enum: 'Status', member: 'ARCHIVED' },
      to: { namespaceId: asNamespaceId('app'), enum: 'Status', member: 'RETIRED' },
    } as const;
    expect(
      appliedStatementsInOrder(
        [enumValueRename, rename],
        [
          { statement: rename, operations: { kind: 'planned', operationIndexes: [0] } },
          { statement: enumValueRename, operations: { kind: 'plannedWithDiff' } },
        ],
        (statement) => (statement === enumValueRename ? [4, 5] : []),
      ),
    ).toEqual([
      { statement: enumValueRename, operationIndexes: [4, 5] },
      { statement: rename, operationIndexes: [0] },
    ]);
  });
});

describe('planStatements', () => {
  it('applies model renames in order and reports the operations each accounts for', () => {
    const origin = contractOf({ Profile: { table: 'Profile' }, Post: { table: 'Post' } });
    const destination = contractOf({ User: { table: 'User' }, Article: { table: 'Article' } });
    const result = planStatements({
      policy: ALL_CLASSES,
      statements: [renameModel('Profile', 'User'), renameModel('Post', 'Article')],
      fromContract: origin,
      contract: destination,
      target: fakeTarget(['app.Profile', 'app.Post']),
    });
    expect(planned(result)).toEqual({
      calls: ['table app.Profile -> User', 'table app.Post -> Article'],
      tableRenames: [
        { namespaceId: 'app', from: 'Profile', to: 'User' },
        { namespaceId: 'app', from: 'Post', to: 'Article' },
      ],
      columnRenames: [],
      plannedStatements: [
        {
          statement: renameModel('Profile', 'User'),
          operations: { kind: 'planned', operationIndexes: [0, 1] },
        },
        {
          statement: renameModel('Post', 'Article'),
          operations: { kind: 'planned', operationIndexes: [2, 3] },
        },
      ],
    });
  });

  it('applies a statement whose table does not change with no operations', () => {
    const result = planStatements({
      policy: ALL_CLASSES,
      statements: [renameModel('Profile', 'User')],
      fromContract: contractOf({ Profile: { table: 'profile' } }),
      contract: contractOf({ User: { table: 'profile' } }),
      target: fakeTarget(['app.profile']),
    });
    expect(planned(result)).toMatchObject({
      calls: [],
      tableRenames: [],
      plannedStatements: [{ operations: { kind: 'planned', operationIndexes: [] } }],
    });
  });

  it.each(['external', 'observed', 'tolerated'] as const)(
    'rejects renaming a table whose control policy is %s',
    (control) => {
      const conflict = rejection(
        planStatements({
          policy: ALL_CLASSES,
          statements: [renameModel('Profile', 'User')],
          fromContract: contractOf({ Profile: { table: 'Profile' } }),
          contract: contractOf({ User: { table: 'User', control } }),
          target: fakeTarget(['app.Profile']),
        }),
      );
      expect(conflict).toMatchObject({
        kind: 'statementRefused',
        location: { namespaceId: 'app', entityKind: 'table', entityName: 'User' },
      });
      expect(conflict.summary).toContain(`control policy is "${control}"`);
    },
  );

  it('rejects a rename whose table the schema being planned from does not have', () => {
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [renameModel('Profile', 'User')],
        fromContract: contractOf({ Profile: { table: 'Profile' } }),
        contract: contractOf({ User: { table: 'User' } }),
        target: fakeTarget([]),
      }),
    );
    expect(conflict.kind).toBe('statementRefused');
    expect(conflict.summary).toContain('has no table "Profile"');
  });

  it('rejects a rename whose new table the schema being planned from already has', () => {
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [renameModel('Profile', 'User')],
        fromContract: contractOf({ Profile: { table: 'Profile' } }),
        contract: contractOf({ User: { table: 'User' } }),
        target: fakeTarget(['app.Profile', 'app.User']),
      }),
    );
    expect(conflict.summary).toContain('already has a table "User"');
  });

  it('rejects a rename onto a name another table holds in another case where the target ignores case', () => {
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [renameModel('Profile', 'User')],
        fromContract: contractOf({ Profile: { table: 'Profile' } }),
        contract: contractOf({ User: { table: 'User' } }),
        target: fakeTarget(['app.Profile', 'app.user'], {}, ['widening'], ignoringCase),
      }),
    );
    expect(conflict.summary).toBe(
      'Cannot rename table "Profile" to "User": the schema being planned from already has a table "User", as "user"',
    );
  });

  it('plans a rename that changes only the case of the table name where the target ignores case', () => {
    const result = planned(
      planStatements({
        policy: ALL_CLASSES,
        statements: [renameModel('profile', 'Profile')],
        fromContract: contractOf({ profile: { table: 'profile' } }),
        contract: contractOf({ Profile: { table: 'Profile' } }),
        target: fakeTarget(['app.profile'], {}, ['widening'], ignoringCase),
      }),
    );
    expect(result.calls).toEqual(['table app.profile -> Profile']);
  });

  it('rejects a rename whose operations the policy does not allow', () => {
    const statement = renameModel('Profile', 'User');
    const conflict = rejection(
      planStatements({
        policy: { allowedOperationClasses: ['additive'] },
        statements: [statement],
        fromContract: contractOf({ Profile: { table: 'Profile' } }),
        contract: contractOf({ User: { table: 'User' } }),
        target: fakeTarget(['app.Profile']),
      }),
    );
    expect(conflict).toMatchObject({
      kind: 'statementRefused',
      refusedStatement: statement,
      refusedOperationClass: 'widening',
    });
    expect(conflict.summary).toContain('does not allow "widening" operations');
  });

  it('rejects statements when there is no origin contract', () => {
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [renameModel('Profile', 'User')],
        fromContract: null,
        contract: contractOf({ User: { table: 'User' } }),
        target: fakeTarget(['app.Profile']),
      }),
    );
    expect(conflict.kind).toBe('statementRefused');
  });
});
