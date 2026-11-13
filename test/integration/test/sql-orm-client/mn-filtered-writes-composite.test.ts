import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

const Course = model('Course', {
  fields: {
    tenantId: field.column(int4Column).column('tenant_id'),
    id: field.column(int4Column),
    name: field.column(textColumn),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.tenantId, fields.id]),
  }))
  .sql({ table: 'composite_courses' });

const Enrollment = model('Enrollment', {
  fields: {
    memberId: field.column(int4Column).column('member_id'),
    tenantId: field.column(int4Column).column('tenant_id'),
    courseId: field.column(int4Column).column('course_id'),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.memberId, fields.tenantId, fields.courseId]),
  }))
  .sql({ table: 'composite_enrollments' });

const Member = model('Member', {
  fields: { id: field.column(int4Column).id(), name: field.column(textColumn) },
})
  .relations({
    courses: rel.manyToMany(() => Course, {
      through: () => Enrollment,
      from: 'memberId',
      to: ['tenantId', 'courseId'],
    }),
  })
  .sql({ table: 'composite_members' });

const contract = defineContract({ models: { Member, Course, Enrollment } });
const context = createExecutionContext({
  contract,
  stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
});

async function seedCompositeTables(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists composite_enrollments');
  await runtime.query('drop table if exists composite_courses');
  await runtime.query('drop table if exists composite_members');
  await runtime.query(
    'create table composite_members (id integer primary key, name text not null)',
  );
  await runtime.query(`
    create table composite_courses (
      tenant_id integer not null,
      id integer not null,
      name text not null,
      primary key (tenant_id, id)
    )
  `);
  await runtime.query(`
    create table composite_enrollments (
      member_id integer not null,
      tenant_id integer not null,
      course_id integer not null,
      primary key (member_id, tenant_id, course_id)
    )
  `);
  await runtime.query("insert into composite_members values (1, 'Alice'), (2, 'Bob')");
  await runtime.query(`
    insert into composite_courses (tenant_id, id, name)
    values (1, 1, 'Math'), (2, 2, 'Math'), (1, 2, 'Math'), (2, 1, 'Math')
  `);
  await runtime.query(`
    insert into composite_enrollments (member_id, tenant_id, course_id)
    values (1, 1, 1), (1, 2, 2), (2, 1, 2)
  `);
}

function courseRows(runtime: PgIntegrationRuntime) {
  return runtime.query<{ tenant_id: number; id: number; name: string }>(
    'select tenant_id, id, name from composite_courses order by tenant_id, id',
  );
}

describe('integration/nested updateAll() and deleteAll() on a many-to-many relation with a composite target key', () => {
  it(
    'updateAll() changes only the linked courses whose every key column matches',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedCompositeTables(runtime);
        const members = new Collection({ runtime, context }, 'Member', { namespaceId: 'public' });

        await members.where({ id: 1 }).update({
          courses: (courses) => courses.where({ name: 'Math' }).updateAll({ name: 'Changed' }),
        });

        expect(await courseRows(runtime)).toEqual([
          { tenant_id: 1, id: 1, name: 'Changed' },
          { tenant_id: 1, id: 2, name: 'Math' },
          { tenant_id: 2, id: 1, name: 'Math' },
          { tenant_id: 2, id: 2, name: 'Changed' },
        ]);
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );
});
