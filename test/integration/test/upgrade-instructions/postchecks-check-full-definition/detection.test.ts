import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');
const GUIDE_PATH =
  'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md';

function detectionOf(id: string): readonly RegExp[] {
  return detectionPatterns(GUIDE_PATH, id);
}

function matching(patterns: readonly RegExp[], content: string): number[] {
  return patterns.flatMap((pattern, index) => (pattern.test(content) ? [index] : []));
}

function opsJson(operations: readonly unknown[]): string {
  return JSON.stringify(operations, null, 2);
}

function exampleOpsJson(example: string): readonly string[] {
  const root = join(repoRoot, 'examples', example, 'migrations/app');
  return readdirSync(root).map((migration) =>
    readFileSync(join(root, migration, 'ops.json'), 'utf-8'),
  );
}

const existsQuery = (table: string) =>
  `SELECT COUNT(*) > 0 AS "result" FROM "${table}" WHERE ("type" = ? AND "name" = ?)`;

const oldSqlite = {
  createTable: opsJson([
    {
      id: 'table.User',
      postcheck: [{ description: 'verify table "User" exists', sql: existsQuery('sqlite_master') }],
    },
  ]),
  addColumn: opsJson([
    {
      id: 'column.User.email',
      postcheck: [
        {
          description: 'verify column "email" exists',
          sql: 'SELECT COUNT(*) > 0 AS "result" FROM pragma_table_info(?) WHERE "name" = ?',
        },
      ],
    },
  ]),
  createIndex: opsJson([
    {
      id: 'index.User.User_email_idx',
      postcheck: [
        { description: 'verify index "User_email_idx" exists', sql: existsQuery('sqlite_master') },
      ],
    },
  ]),
  recreateTable: opsJson([
    {
      id: 'recreateTable.Post',
      postcheck: [
        {
          description: 'verify foreign key (authorId) → User(id) on "Post"',
          sql: `SELECT EXISTS (SELECT 1 FROM pragma_foreign_key_list('Post') f WHERE f."table" = 'User' GROUP BY f.id HAVING COUNT(*) = 1)`,
        },
      ],
    },
  ]),
};

const newSqlite = opsJson([
  {
    id: 'table.User',
    postcheck: [
      { description: 'verify table "User" exists', sql: existsQuery('sqlite_master') },
      { description: 'verify table "User" has exactly its columns', sql: 'SELECT 1' },
    ],
  },
  {
    id: 'column.User.email',
    postcheck: [
      {
        description: 'verify column "email" exists',
        sql: 'SELECT COUNT(*) > 0 AS "result" FROM pragma_table_info(?) WHERE "name" = ?',
      },
      { description: 'verify column "email" on "User" has type TEXT and is required', sql: '1' },
    ],
  },
  {
    id: 'index.User.User_email_idx',
    postcheck: [
      { description: 'verify index "User_email_idx" exists', sql: existsQuery('sqlite_master') },
      { description: 'verify index "User_email_idx" on "User" covers (email)', sql: '1' },
    ],
  },
  {
    id: 'recreateTable.Post',
    postcheck: [
      {
        description: 'verify foreign key (authorId) → User(id) on "Post"',
        sql: `SELECT EXISTS (SELECT 1 FROM pragma_foreign_key_list('Post') f WHERE f."table" = 'User' AND f.on_delete = 'CASCADE' AND f.on_update = 'NO ACTION' GROUP BY f.id HAVING COUNT(*) = 1)`,
      },
    ],
  },
]);

const oldMongo = {
  createIndex: opsJson([
    {
      id: 'index.users.create(email:1)',
      postcheck: [
        {
          description: 'index exists on users',
          source: { kind: 'listIndexes', collection: 'users' },
          filter: { kind: 'field', field: 'key', op: '$eq', value: { email: 1 } },
          expect: 'exists',
        },
      ],
    },
  ]),
  collMod: opsJson([
    {
      id: 'collection.users.collMod',
      postcheck: [
        {
          description: 'validator applied on users',
          source: { kind: 'listCollections' },
          filter: {
            kind: 'and',
            exprs: [{ kind: 'field', field: 'name', op: '$eq', value: 'users' }],
          },
          expect: 'exists',
        },
      ],
    },
  ]),
};

const newPostgres = [
  ...exampleOpsJson('prisma-8-demo'),
  ...exampleOpsJson('prisma-8-postgis-demo'),
  readFileSync(
    join(repoRoot, 'test/integration/test/planner-golden/fixtures/postgres/planned.golden.json'),
    'utf-8',
  ),
];
const newMongo = [...exampleOpsJson('mongo-demo'), ...exampleOpsJson('retail-store')];

describe('sqlite-postchecks-check-full-definition detection', () => {
  const patterns = detectionOf('sqlite-postchecks-check-full-definition');

  it('finds each operation an earlier release wrote', () => {
    expect({
      createTable: matching(patterns, oldSqlite.createTable),
      addColumn: matching(patterns, oldSqlite.addColumn),
      createIndex: matching(patterns, oldSqlite.createIndex),
      recreateTable: matching(patterns, oldSqlite.recreateTable),
    }).toEqual({ createTable: [0], addColumn: [1], createIndex: [2], recreateTable: [3] });
  });

  it('skips what this release writes, for SQLite and for the other targets', () => {
    expect(
      [
        newSqlite,
        readFileSync(
          join(
            repoRoot,
            'test/integration/test/planner-golden/fixtures/sqlite/planned.golden.json',
          ),
          'utf-8',
        ),
        ...newPostgres,
        ...newMongo,
      ].flatMap((content) => matching(patterns, content)),
    ).toEqual([]);
  });
});

describe('mongo-postchecks-check-full-definition detection', () => {
  const patterns = detectionOf('mongo-postchecks-check-full-definition');

  it('finds each operation an earlier release wrote', () => {
    expect({
      createIndex: matching(patterns, oldMongo.createIndex),
      collMod: matching(patterns, oldMongo.collMod),
    }).toEqual({ createIndex: [0], collMod: [1] });
  });

  it('skips what this release writes, for MongoDB and for the other targets', () => {
    expect(
      [...newMongo, ...newPostgres, newSqlite].flatMap((content) => matching(patterns, content)),
    ).toEqual([]);
  });
});
