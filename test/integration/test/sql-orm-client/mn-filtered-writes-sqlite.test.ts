import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { integerColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import { soleDomainNamespaceId } from '@internal/contract/types';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { Collection, or } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import { defineContract, field, model, rel } from '@internal/sqlite/contract-builder';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const Course = model('Course', {
  fields: {
    tenantId: field.column(integerColumn).column('tenant_id'),
    id: field.column(integerColumn),
    name: field.column(textColumn),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.tenantId, fields.id]),
  }))
  .sql({ table: 'courses' });

const Enrollment = model('Enrollment', {
  fields: {
    userId: field.column(integerColumn).column('user_id'),
    tenantId: field.column(integerColumn).column('tenant_id'),
    courseId: field.column(integerColumn).column('course_id'),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.userId, fields.tenantId, fields.courseId]),
  }))
  .sql({ table: 'enrollments' });

const UserBase = model('User', {
  fields: { id: field.column(integerColumn).id(), name: field.column(textColumn) },
}).sql({ table: 'users' });

const Tag = model('Tag', {
  fields: { id: field.column(integerColumn).id(), name: field.column(textColumn) },
}).sql({ table: 'tags' });

const UserTag = model('UserTag', {
  fields: {
    userId: field.column(integerColumn).column('user_id'),
    tagId: field.column(integerColumn).column('tag_id'),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.userId, fields.tagId]),
  }))
  .sql({ table: 'user_tags' });

const User = UserBase.relations({
  courses: rel.manyToMany(() => Course, {
    through: () => Enrollment,
    from: 'userId',
    to: ['tenantId', 'courseId'],
  }),
  tags: rel.manyToMany(() => Tag, { through: () => UserTag, from: 'userId', to: 'tagId' }),
}).sql({ table: 'users' });

const contract = defineContract({ models: { User, Tag, UserTag, Course, Enrollment } });

const schemaSql = `
  create table users (id integer primary key, name text not null);
  create table tags (id integer primary key, name text not null);
  create table user_tags (
    user_id integer not null references users (id),
    tag_id integer not null references tags (id),
    primary key (user_id, tag_id)
  );
  create table courses (
    tenant_id integer not null,
    id integer not null,
    name text not null,
    primary key (tenant_id, id)
  );
  create table enrollments (
    user_id integer not null,
    tenant_id integer not null,
    course_id integer not null,
    primary key (user_id, tenant_id, course_id)
  );
`;

interface Harness {
  readonly users: Collection<typeof contract, 'User'>;
  rows(sql: string): unknown[];
}

const cascadingSchemaSql = schemaSql.replace(
  'references tags (id)',
  'references tags (id) on delete cascade',
);

async function withSqlite(
  seedSql: string,
  fn: (harness: Harness) => Promise<void>,
  tablesSql = schemaSql,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'orm-nested-mutation-arrays-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(tablesSql);
  database.exec(seedSql);

  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
  });
  const context = createExecutionContext({ contract, stack });
  const { adapter, driver } = instantiateExecutionStack(stack);
  if (adapter === undefined || driver === undefined) {
    throw new InternalError('SQLite execution stack is missing its adapter or driver');
  }
  await driver.connect({ kind: 'path', path });
  const runtime = new SqliteRuntimeImpl({ context, adapter, driver, closeRefusal: undefined });
  const namespaceId = soleDomainNamespaceId(contract.domain);
  try {
    await fn({
      users: new Collection({ runtime, context }, 'User', { namespaceId }),
      rows: (sql) => database.prepare(sql).all(),
    });
  } finally {
    await runtime.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('integration/nested updateAll() and deleteAll() on a many-to-many relation on SQLite', () => {
  const twoUsersWithTagsSeedSql = `
    insert into users values (1, 'Alice'), (2, 'Bob');
    insert into tags values (1, 'Rust'), (2, 'TypeScript'), (3, 'Go');
    insert into user_tags values (1, 1), (1, 2), (2, 3);
  `;
  const tagRowsSql = 'select id, name from tags order by id';
  const userTagRowsSql = 'select user_id, tag_id from user_tags order by user_id, tag_id';
  const seededUserTagRows = [
    { user_id: 1, tag_id: 1 },
    { user_id: 1, tag_id: 2 },
    { user_id: 2, tag_id: 3 },
  ];

  it(
    'update() where().updateAll() on a junction relation changes a matching linked tag and leaves a matching tag linked only to another user unchanged',
    async () => {
      await withSqlite(twoUsersWithTagsSeedSql, async ({ users, rows }) => {
        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name').orderBy((tag) => tag['id']!.asc()))
          .update({
            tags: (tags) =>
              tags
                .where((tag) => or(tag['name']!.eq('Rust'), tag['name']!.eq('Go')))
                .updateAll({ name: 'Changed' }),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          tags: [
            { id: 1, name: 'Changed' },
            { id: 2, name: 'TypeScript' },
          ],
        });
        expect(rows(tagRowsSql)).toEqual([
          { id: 1, name: 'Changed' },
          { id: 2, name: 'TypeScript' },
          { id: 3, name: 'Go' },
        ]);
        expect(rows(userTagRowsSql)).toEqual(seededUserTagRows);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() where().deleteAll() with cascading junction keys deletes a matching linked tag and its junction rows, leaving a matching tag linked only to another user',
    async () => {
      await withSqlite(
        twoUsersWithTagsSeedSql,
        async ({ users, rows }) => {
          const updated = await users
            .where({ id: 1 })
            .select('id', 'name')
            .include('tags', (tags) => tags.select('id', 'name'))
            .update({
              tags: (tags) =>
                tags.where((tag) => or(tag['name']!.eq('Rust'), tag['name']!.eq('Go'))).deleteAll(),
            });

          expect(updated).toEqual({
            id: 1,
            name: 'Alice',
            tags: [{ id: 2, name: 'TypeScript' }],
          });
          expect(rows(tagRowsSql)).toEqual([
            { id: 2, name: 'TypeScript' },
            { id: 3, name: 'Go' },
          ]);
          expect(rows(userTagRowsSql)).toEqual([
            { user_id: 1, tag_id: 2 },
            { user_id: 2, tag_id: 3 },
          ]);
        },
        cascadingSchemaSql,
      );
    },
    timeouts.databaseOperation,
  );

  it(
    'update() where().updateAll() on a junction relation with a composite target key changes only the linked targets whose every key column matches',
    async () => {
      await withSqlite(
        `
          insert into users values (1, 'Alice'), (2, 'Bob');
          insert into courses values (1, 1, 'Math'), (2, 2, 'Math'), (1, 2, 'Math'), (2, 1, 'Math');
          insert into enrollments values (1, 1, 1), (1, 2, 2), (2, 1, 2);
        `,
        async ({ users, rows }) => {
          await users.where({ id: 1 }).update({
            courses: (courses) => courses.where({ name: 'Math' }).updateAll({ name: 'Changed' }),
          });

          expect(rows('select tenant_id, id, name from courses order by tenant_id, id')).toEqual([
            { tenant_id: 1, id: 1, name: 'Changed' },
            { tenant_id: 1, id: 2, name: 'Math' },
            { tenant_id: 2, id: 1, name: 'Math' },
            { tenant_id: 2, id: 2, name: 'Changed' },
          ]);
        },
      );
    },
    timeouts.databaseOperation,
  );
});
