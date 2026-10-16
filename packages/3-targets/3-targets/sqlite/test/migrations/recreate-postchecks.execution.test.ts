/**
 * The recreate postchecks, run against a real SQLite database in the shape a rebuild leaves behind. They must hold for a correct rebuild and fail while a removed constraint remains.
 */

import { DatabaseSync } from 'node:sqlite';
import { sqlRawDataType } from '@internal/sql-contract/data-type';
import { SqlColumnIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import type { SqliteTableSpec } from '../../src/core/migrations/operations/shared';
import { buildRecreatePostchecks } from '../../src/core/migrations/operations/tables';
import { actualColumn, expectedColumn, foreignKey, issue, unique } from './node-issue-helpers';

const codesSpec: SqliteTableSpec = {
  columns: [
    { name: 'code', typeSql: 'TEXT', nullable: false },
    { name: 'label', typeSql: 'TEXT', nullable: false },
  ],
  primaryKey: { columns: ['code'] },
  uniques: [{ columns: ['code'] }],
  foreignKeys: [],
};

const uniqueIssues = [
  issue({ path: ['database', 'codes', 'unique:code'], expected: unique(['code']) }),
];

function postcheckResults(
  createTableSql: string,
  tableName = 'codes',
  issues: Parameters<typeof buildRecreatePostchecks>[1] = uniqueIssues,
  spec: SqliteTableSpec = codesSpec,
): Record<string, boolean> {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(createTableSql);
    return Object.fromEntries(
      buildRecreatePostchecks(tableName, issues, spec).map((check) => {
        if (!('sql' in check)) {
          throw new Error(`postcheck "${check.description}" carries no SQL to run`);
        }
        return [check.description, Object.values(db.prepare(check.sql).get() ?? {})[0] === 1];
      }),
    );
  } finally {
    db.close();
  }
}

describe('buildRecreatePostchecks on SQLite', () => {
  it('holds after a rebuild whose unique constraint repeats a text primary key', () => {
    const results = postcheckResults(
      'CREATE TABLE "codes" ("code" TEXT NOT NULL, "label" TEXT NOT NULL, PRIMARY KEY ("code"), UNIQUE ("code"))',
    );

    expect(Object.values(results)).toEqual(Object.values(results).map(() => true));
    expect(Object.keys(results).length).toBeGreaterThan(1);
  });

  it('fails while a unique constraint the rebuild removes is still there', () => {
    const results = postcheckResults(
      'CREATE TABLE "codes" ("code" TEXT NOT NULL, "label" TEXT NOT NULL, PRIMARY KEY ("code"), UNIQUE ("code"), UNIQUE ("label"))',
    );

    expect(Object.values(results)).toContain(false);
  });
});

function typePostcheckHolds(
  declaredType: string,
  column: { readonly typeSql: string; readonly expected: SqlColumnIR },
): boolean {
  const spec: SqliteTableSpec = {
    columns: [{ name: 'shape', typeSql: column.typeSql, nullable: true }],
    uniques: [],
    foreignKeys: [],
  };
  const issues = [
    issue({
      path: ['database', 'places', 'column:shape'],
      expected: column.expected,
      actual: actualColumn({ name: 'shape', nativeType: 'blob', nullable: true }),
    }),
  ];
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE "places" ("shape" ${declaredType})`);
    const [check] = buildRecreatePostchecks('places', issues, spec);
    if (check === undefined || !('sql' in check)) {
      throw new Error('expected one type postcheck carrying SQL');
    }
    return Object.values(db.prepare(check.sql).get() ?? {})[0] === 1;
  } finally {
    db.close();
  }
}

describe('the type postcheck of a recreated table', () => {
  const rawCircle = {
    typeSql: 'circle',
    expected: new SqlColumnIR({
      name: 'shape',
      nativeType: 'circle',
      nullable: true,
      resolvedNativeType: 'circle',
      dataType: sqlRawDataType,
    }),
  };
  const integer = {
    typeSql: 'INTEGER',
    expected: expectedColumn({ name: 'shape', nativeType: 'integer', nullable: true }),
  };

  it('compares a type named by its catalog text exactly, case included, as verify does', () => {
    expect({
      exact: typePostcheckHolds('circle', rawCircle),
      otherCase: typePostcheckHolds('CIRCLE', rawCircle),
    }).toEqual({ exact: true, otherCase: false });
  });

  it('compares any other type without case', () => {
    expect({
      upper: typePostcheckHolds('INTEGER', integer),
      lower: typePostcheckHolds('integer', integer),
    }).toEqual({ upper: true, lower: true });
  });
});

const postSpec = (onDelete: 'cascade' | 'setNull' | undefined): SqliteTableSpec => ({
  columns: [
    { name: 'id', typeSql: 'INTEGER', nullable: false },
    { name: 'authorId', typeSql: 'INTEGER', nullable: true },
  ],
  primaryKey: { columns: ['id'] },
  foreignKeys: [
    {
      columns: ['authorId'],
      references: { table: 'User', columns: ['id'] },
      ...(onDelete === undefined ? {} : { onDelete }),
    },
  ],
});

const foreignKeyIssues = [
  issue({
    path: ['database', 'Post', 'foreign-key:authorId->.User(id)'],
    expected: foreignKey({
      columns: ['authorId'],
      referencedTable: 'User',
      referencedColumns: ['id'],
      onDelete: 'setNull',
    }),
    actual: foreignKey({
      columns: ['authorId'],
      referencedTable: 'User',
      referencedColumns: ['id'],
      onDelete: 'cascade',
    }),
  }),
];

const postTableSql = (actions: string) =>
  `CREATE TABLE "Post" ("id" INTEGER NOT NULL, "authorId" INTEGER, PRIMARY KEY ("id"), FOREIGN KEY ("authorId") REFERENCES "User" ("id")${actions})`;

describe('buildRecreatePostchecks on SQLite for a foreign key action', () => {
  it('fails while the foreign key still has the old action', () => {
    const results = postcheckResults(
      postTableSql(' ON DELETE CASCADE'),
      'Post',
      foreignKeyIssues,
      postSpec('setNull'),
    );

    expect(Object.values(results)).toContain(false);
  });

  it('holds once the foreign key has the new actions', () => {
    const results = postcheckResults(
      postTableSql(' ON DELETE SET NULL'),
      'Post',
      foreignKeyIssues,
      postSpec('setNull'),
    );

    expect(Object.values(results)).toEqual(Object.values(results).map(() => true));
  });

  it('reads an absent action as NO ACTION', () => {
    const results = [
      postcheckResults(postTableSql(''), 'Post', foreignKeyIssues, postSpec(undefined)),
      postcheckResults(
        postTableSql(' ON DELETE CASCADE'),
        'Post',
        foreignKeyIssues,
        postSpec(undefined),
      ),
    ].map((result) => Object.values(result).every(Boolean));

    expect(results).toEqual([true, false]);
  });
});
