import {
  int4Column,
  textColumn,
  timestamptzJsDateColumn,
} from '@internal/adapter-postgres/column-types';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import { parseMutationInput } from '../../src/relation-mutations';
import { updateFirstGraph } from '../../src/statement-graph/collection-graphs';
import { defineContract, field, gen, model, rel } from '../contract-builder';
import { buildTestContextFromContract, createMockRuntime } from '../helpers';
import { printGraph } from './print-graph';

interface Disconnectable {
  disconnect(criteria?: readonly object[]): unknown;
}

function printUpdate(
  contract: Contract<SqlStorage>,
  modelName: string,
  input: Record<string, unknown>,
): string {
  const context = buildTestContextFromContract(contract);
  const runtime = createMockRuntime();
  const parsed = parseMutationInput(
    context.contract,
    'public',
    modelName,
    input as never,
    (relation) =>
      new Collection({ runtime, context }, relation.to, { namespaceId: relation.toNamespace }),
  );
  const collection = new Collection({ runtime, context }, modelName, { namespaceId: 'public' });
  return printGraph(
    updateFirstGraph(
      { context, state: collection.where({ id: 1 }).state, modelName, namespaceId: 'public' },
      {},
      parsed.relationMutations,
    ),
  );
}

function compositeKeyContract() {
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
      tenantId: field.column(int4Column).column('tenant_id').optional(),
      customerId: field.column(int4Column).column('customer_id').optional(),
    },
    relations: {
      customer: rel.belongsTo(CustomerBase, {
        from: ['tenantId', 'customerId'],
        to: ['tenantId', 'id'],
      }),
    },
  }).sql({ table: 'orders' });
  const Customer = CustomerBase.relations({
    orders: rel.hasMany(() => Order, { by: ['tenantId', 'customerId'] }),
  }).sql({ table: 'customers' });
  return defineContract({ models: { Customer, Order } });
}

function updateDefaultContract() {
  const Author = model('Author', {
    fields: { id: field.column(int4Column).id(), name: field.column(textColumn) },
  }).sql({ table: 'authors' });
  const Article = model('Article', {
    fields: {
      id: field.column(int4Column).id(),
      authorId: field.column(int4Column).column('author_id').optional(),
      updatedAt: field.column(timestamptzJsDateColumn).column('updated_at').onUpdate(gen.now()),
    },
    relations: { author: rel.belongsTo(Author, { from: 'authorId', to: 'id' }) },
  }).sql({ table: 'articles' });
  return defineContract({ models: { Author, Article } });
}

describe('disconnect with criteria on a relation the parent holds the key for', () => {
  it('compares a composite key with a row value', () => {
    expect(
      printUpdate(compositeKeyContract(), 'Order', {
        customer: (customer: Disconnectable) => customer.disconnect([{ name: 'Acme' }]),
      }),
    ).toBe(
      [
        'n1 Find orders where id = 1',
        "n2 Update orders set tenant_id = null, customer_id = null where (tenant_id, customer_id) in (select tenant_id, id from customers where name = 'Acme') <- FilterData n1 (id->id)",
        'n3 Find orders <- FilterData n1 (id->id)',
        'result: n3',
      ].join('\n'),
    );
  });

  it('applies the update defaults of the parent to the Update that unlinks it', () => {
    expect(
      printUpdate(updateDefaultContract(), 'Article', {
        author: (author: Disconnectable) => author.disconnect([{ id: 2 }]),
      }),
    ).toMatch(
      /^n2 Update articles set author_id = null, updated_at = \d{4}-\d\d-\d\dT[\d:.]+Z where author_id in \(select id from authors where id = 2\) <- FilterData n1 \(id->id\)$/m,
    );
  });
});
