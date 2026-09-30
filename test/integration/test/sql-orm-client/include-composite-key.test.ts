import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

const CustomerBase = model('Customer', {
  fields: {
    tenantId: field.column(int4Column).column('tenant_id'),
    id: field.column(int4Column),
    name: field.column(textColumn),
  },
}).attributes(({ fields, constraints }) => ({
  id: constraints.id([fields.tenantId, fields.id]),
}));

const Order = model('Order', {
  fields: {
    id: field.column(int4Column).id(),
    tenantId: field.column(int4Column).column('tenant_id'),
    customerId: field.column(int4Column).column('customer_id').optional(),
    label: field.column(textColumn),
  },
  relations: {
    customer: rel.belongsTo(CustomerBase, {
      from: ['tenantId', 'customerId'],
      to: ['tenantId', 'id'],
    }),
  },
}).sql({ table: 'composite_orders' });

const Customer = CustomerBase.relations({
  orders: rel.hasMany(() => Order, { by: ['tenantId', 'customerId'] }),
}).sql({ table: 'composite_customers' });

const contract = defineContract({ models: { Customer, Order } });
const context = createExecutionContext({
  contract,
  stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
});

// The DSL types a relation's target model as any string and its cardinality as a union. So an
// include refinement here sees an accessor keyed by any string, and its count() is typed away.
const countRelated = (related: unknown): unknown => (related as { count: () => unknown }).count();

async function seedCompositeTables(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists composite_orders');
  await runtime.query('drop table if exists composite_customers');
  await runtime.query(`
    create table composite_customers (
      tenant_id integer not null,
      id integer not null,
      name text not null,
      primary key (tenant_id, id)
    )
  `);
  await runtime.query(`
    create table composite_orders (
      id integer primary key,
      tenant_id integer not null,
      customer_id integer,
      label text not null
    )
  `);
  await runtime.query(`
    insert into composite_customers (tenant_id, id, name)
    values (1, 1, 'Ada'), (1, 2, 'Grace'), (2, 1, 'Edsger')
  `);
  await runtime.query(`
    insert into composite_orders (id, tenant_id, customer_id, label)
    values
      (10, 1, 1, 'ada-1'),
      (11, 1, 2, 'grace-1'),
      (12, 1, 1, 'ada-2'),
      (13, 1, null, 'unassigned'),
      (14, 2, 1, 'edsger-1')
  `);
}

async function withCompositeTables(
  fn: (collections: {
    customers: Collection<typeof contract, 'Customer'>;
    orders: Collection<typeof contract, 'Order'>;
  }) => Promise<void>,
): Promise<void> {
  await withCollectionRuntime(async (runtime) => {
    await seedCompositeTables(runtime);
    await fn({
      customers: new Collection({ runtime, context }, 'Customer', { namespaceId: 'public' }),
      orders: new Collection({ runtime, context }, 'Order', { namespaceId: 'public' }),
    });
  }, contract);
}

describe('integration/include over a composite foreign key', () => {
  it(
    'a to-one include returns the parent that matches every key column',
    async () => {
      await withCompositeTables(async ({ orders }) => {
        const rows = await orders
          .select('id', 'label')
          .orderBy((order) => order.id.asc())
          .include('customer', (customer) => customer.select('tenantId', 'id', 'name'))
          .all();

        expect(rows).toEqual([
          { id: 10, label: 'ada-1', customer: { tenantId: 1, id: 1, name: 'Ada' } },
          { id: 11, label: 'grace-1', customer: { tenantId: 1, id: 2, name: 'Grace' } },
          { id: 12, label: 'ada-2', customer: { tenantId: 1, id: 1, name: 'Ada' } },
          { id: 13, label: 'unassigned', customer: null },
          { id: 14, label: 'edsger-1', customer: { tenantId: 2, id: 1, name: 'Edsger' } },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a to-many include returns only the children that match every key column',
    async () => {
      await withCompositeTables(async ({ customers }) => {
        const rows = await customers
          .select('tenantId', 'id', 'name')
          .orderBy([(customer) => customer.tenantId.asc(), (customer) => customer.id.asc()])
          .include('orders', (order) => order.select('id', 'label').orderBy((o) => o['id']!.asc()))
          .all();

        expect(rows).toEqual([
          {
            tenantId: 1,
            id: 1,
            name: 'Ada',
            orders: [
              { id: 10, label: 'ada-1' },
              { id: 12, label: 'ada-2' },
            ],
          },
          { tenantId: 1, id: 2, name: 'Grace', orders: [{ id: 11, label: 'grace-1' }] },
          { tenantId: 2, id: 1, name: 'Edsger', orders: [{ id: 14, label: 'edsger-1' }] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a count() include counts only the children that match every key column',
    async () => {
      await withCompositeTables(async ({ customers }) => {
        const rows = await customers
          .select('tenantId', 'id', 'name')
          .orderBy([(customer) => customer.tenantId.asc(), (customer) => customer.id.asc()])
          .include('orders', (order) => countRelated(order) as never)
          .all();

        expect(rows).toEqual([
          { tenantId: 1, id: 1, name: 'Ada', orders: 2 },
          { tenantId: 1, id: 2, name: 'Grace', orders: 1 },
          { tenantId: 2, id: 1, name: 'Edsger', orders: 1 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
