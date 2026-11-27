import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import {
  defineContract,
  field,
  model,
  postgres18,
  postgresDriver,
  rel,
} from '@internal/postgres/contract-builder';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { includeStrategies, withIncludeStrategy } from './helpers';
import { timeouts, withPushedContractRuntime } from './integration-helpers';

const OwnerBase = model('Owner', {
  fields: {
    code: field.column(textColumn).id(),
    name: field.column(textColumn),
  },
}).sql({ table: 'ci_owners' });

const Item = model('Item', {
  fields: {
    id: field.column(int4Column).id(),
    ownerCode: field.column(textColumn).column('owner_code'),
    label: field.column(textColumn),
  },
  relations: {
    owner: rel.belongsTo(OwnerBase, { from: 'ownerCode', to: 'code' }),
  },
}).sql({ table: 'ci_items' });

const Owner = OwnerBase.relations({
  items: rel.hasMany(() => Item, { by: 'ownerCode' }),
}).sql({ table: 'ci_owners' });

const contract = defineContract({
  requiredCapabilities: [...postgres18, ...postgresDriver],
  models: { Owner, Item },
});

describe.each(includeStrategies)('includes matched by a case-insensitive key (%s)', (strategy) => {
  it(
    'attaches the rows the database matches, whatever the case each side stores',
    async () => {
      const context = createExecutionContext({
        contract: withIncludeStrategy(contract, strategy),
        stack: createSqlExecutionStack({
          target: postgresTarget,
          adapter: postgresAdapter,
        }),
      });
      await withPushedContractRuntime(contract, async (runtime) => {
        await runtime.query('create extension if not exists citext');
        await runtime.query(`
          do $$
          declare constraint_name text;
          begin
            for constraint_name in
              select conname from pg_constraint where conrelid = 'ci_items'::regclass and contype = 'f'
            loop
              execute format('alter table ci_items drop constraint %I', constraint_name);
            end loop;
          end $$
        `);
        await runtime.query('alter table ci_owners alter column code type citext');
        await runtime.query('alter table ci_items alter column owner_code type citext');
        await runtime.query(`insert into ci_owners (code, name) values ('ADA', 'Ada')`);
        await runtime.query(
          `insert into ci_items (id, owner_code, label) values (1, 'ada', 'pen'), (2, 'Ada', 'cup')`,
        );
        const owners = new Collection({ runtime, context }, 'Owner', { namespaceId: 'public' });
        const items = new Collection({ runtime, context }, 'Item', { namespaceId: 'public' });

        expect({
          owners: await owners
            .select('code', 'name')
            .include('items', (item) => item.select('label').orderBy((row) => row.id.asc()))
            .all(),
          items: await items
            .select('label')
            .orderBy((item) => item.id.asc())
            .include('owner', (owner) => owner.select('code'))
            .all(),
        }).toEqual({
          owners: [{ code: 'ADA', name: 'Ada', items: [{ label: 'pen' }, { label: 'cup' }] }],
          items: [
            { label: 'pen', owner: { code: 'ADA' } },
            { label: 'cup', owner: { code: 'ADA' } },
          ],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
