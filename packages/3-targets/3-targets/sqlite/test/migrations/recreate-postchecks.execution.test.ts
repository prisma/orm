/**
 * The recreate postchecks, run against a real SQLite database in the shape a rebuild leaves behind. They must hold for a correct rebuild and fail while a removed constraint remains.
 */

import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { SqliteTableSpec } from '../../src/core/migrations/operations/shared';
import { buildRecreatePostchecks } from '../../src/core/migrations/operations/tables';
import { issue, unique } from './node-issue-helpers';

const codesSpec: SqliteTableSpec = {
  columns: [
    { name: 'code', typeSql: 'TEXT', defaultSql: '', nullable: false },
    { name: 'label', typeSql: 'TEXT', defaultSql: '', nullable: false },
  ],
  primaryKey: { columns: ['code'] },
  uniques: [{ columns: ['code'] }],
  foreignKeys: [],
};

const uniqueIssues = [
  issue({ path: ['database', 'codes', 'unique:code'], expected: unique(['code']) }),
];

function postcheckResults(createTableSql: string): Record<string, boolean> {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(createTableSql);
    return Object.fromEntries(
      buildRecreatePostchecks('codes', uniqueIssues, codesSpec).map((check) => [
        check.description,
        Object.values(db.prepare(check.sql).get() ?? {})[0] === 1,
      ]),
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
