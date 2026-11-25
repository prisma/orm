import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';
import { Collection } from '@internal/sql-orm-client';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { postgresCapabilitiesByVersion } from '@internal/target-postgres/server-version';
import { describe, expect, it } from 'vitest';
import { type IncludeStrategy, includeStrategies, postgresAdapterFor } from './helpers';
import {
  expectPerRelationStatements,
  timeouts,
  withPushedContractRuntime,
} from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

const OwnerBase = model('Owner', {
  fields: {
    id: field.column(int4Column).id(),
    name: field.column(textColumn),
  },
}).sql({ table: 'write_owners' });

const Item = model('Item', {
  fields: {
    id: field.column(int4Column).id(),
    ownerId: field.column(int4Column).column('owner_id'),
    label: field.column(textColumn),
  },
  relations: {
    owner: rel
      .belongsTo(OwnerBase, { from: 'ownerId', to: 'id' })
      .sql({ fk: { onDelete: 'cascade' } }),
  },
}).sql({ table: 'write_items' });

const Owner = OwnerBase.relations({
  items: rel.hasMany(() => Item, { by: 'ownerId' }),
}).sql({ table: 'write_owners' });

const contract = defineContract({ version: 18, models: { Owner, Item } });

type Returning = 'with returning' | 'without returning';

const withoutReturning = {
  ...postgresCapabilitiesByVersion[18],
  postgres: { ...postgresCapabilitiesByVersion[18].postgres, returning: false },
  sql: { ...postgresCapabilitiesByVersion[18].sql, returning: false },
};

function contextOf(
  strategy: IncludeStrategy,
  returning: Returning,
): ExecutionContext<typeof contract> {
  return createExecutionContext({
    contract,
    stack: createSqlExecutionStack({
      target: postgresTarget,
      adapter:
        returning === 'with returning'
          ? postgresAdapterFor(strategy)
          : postgresAdapterFor(strategy, withoutReturning),
    }),
  });
}

async function withOwners(
  strategy: IncludeStrategy,
  returning: Returning,
  fn: (
    runtime: PgIntegrationRuntime,
    collections: {
      owners: Collection<typeof contract, 'Owner'>;
      items: Collection<typeof contract, 'Item'>;
    },
  ) => Promise<void>,
): Promise<void> {
  const context = contextOf(strategy, returning);
  await withPushedContractRuntime(contract, async (runtime) => {
    await runtime.query(`insert into write_owners (id, name) values (1, 'Ada'), (2, 'Bea')`);
    await runtime.query(
      `insert into write_items (id, owner_id, label) values (10, 1, 'pen'), (11, 1, 'cup'), (12, 2, 'hat')`,
    );
    runtime.resetExecutions();
    await fn(runtime, {
      owners: new Collection({ runtime, context }, 'Owner', { namespaceId: 'public' }),
      items: new Collection({ runtime, context }, 'Item', { namespaceId: 'public' }),
    });
  });
}

const statementsByCase: Record<
  Returning,
  Record<'create' | 'update' | 'upsert' | 'delete', number>
> = {
  'with returning': { create: 2, update: 2, upsert: 2, delete: 3 },
  'without returning': { create: 3, update: 4, upsert: 3, delete: 3 },
};

describe.each(includeStrategies)('writes that return rows with includes (%s)', (strategy) => {
  describe.each(['with returning', 'without returning'] as const)('%s', (returning) => {
    const statements = statementsByCase[returning];

    it(
      'create() returns the row with its to-one include',
      async () => {
        await withOwners(strategy, returning, async (runtime, { items }) => {
          const created = await items
            .select('id', 'label')
            .include('owner', (owner) => owner.select('name'))
            .create({ id: 13, ownerId: 2, label: 'map' });
          expectPerRelationStatements(runtime, strategy, statements.create);

          expect(created).toEqual({ id: 13, label: 'map', owner: { name: 'Bea' } });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'update() returns the row with its to-many include',
      async () => {
        await withOwners(strategy, returning, async (runtime, { owners }) => {
          const updated = await owners
            .where({ id: 1 })
            .select('name')
            .include('items', (items) => items.select('label').orderBy((item) => item.id.asc()))
            .update({ name: 'Ada L.' });
          expectPerRelationStatements(runtime, strategy, statements.update);

          expect(updated).toEqual({ name: 'Ada L.', items: [{ label: 'pen' }, { label: 'cup' }] });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'upsert() returns the row with its to-many include',
      async () => {
        await withOwners(strategy, returning, async (runtime, { owners }) => {
          const upserted = await owners
            .select('id', 'name')
            .include('items', (items) => items.select('label').orderBy((item) => item.id.asc()))
            .upsert({ create: { id: 2, name: 'Bea' }, update: { name: 'Bea B.' } });
          expectPerRelationStatements(runtime, strategy, statements.upsert);

          expect(upserted).toEqual({ id: 2, name: 'Bea B.', items: [{ label: 'hat' }] });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'delete() returns the row with the children ON DELETE CASCADE removes with it',
      async () => {
        await withOwners(strategy, returning, async (runtime, { owners }) => {
          const deleted = await owners
            .where({ id: 1 })
            .select('name')
            .include('items', (items) => items.select('label').orderBy((item) => item.id.asc()))
            .delete();
          expectPerRelationStatements(runtime, strategy, statements.delete);

          expect({
            deleted,
            itemsLeft: await runtime.query('select id from write_items order by id'),
          }).toEqual({
            deleted: { name: 'Ada', items: [{ label: 'pen' }, { label: 'cup' }] },
            itemsLeft: [{ id: 12 }],
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'deleteAll() deletes only the rows it found and returns',
      async () => {
        await withOwners(strategy, returning, async (runtime, { owners }) => {
          const deleted = await owners
            .where((owner) => owner.name.eq('Ada'))
            .select('id', 'name')
            .include('items', (items) => items.select('label').orderBy((item) => item.id.asc()))
            .deleteAll();
          const deleteStatement = runtime.executions.find((plan) => /^delete/i.test(plan.sql));

          expect({ deleted, deleteParams: deleteStatement?.params }).toEqual({
            deleted: [{ id: 1, name: 'Ada', items: [{ label: 'pen' }, { label: 'cup' }] }],
            deleteParams: expect.arrayContaining([expect.objectContaining({ value: 1 })]),
          });
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
