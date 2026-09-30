import { charColumn, int4Column } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { timeouts, withPushedContractRuntime } from './integration-helpers';

const TagBase = model('Tag', {
  fields: {
    id: field.column(int4Column).id(),
    ownerId: field.column(int4Column).column('owner_id'),
    code: field.column(charColumn(3)),
  },
}).sql({ table: 'char_tags' });

const Owner = model('Owner', {
  fields: { id: field.column(int4Column).id() },
  relations: { tags: rel.hasMany(() => TagBase, { by: 'ownerId' }) },
}).sql({ table: 'char_owners' });

const contract = defineContract({ models: { Owner, Tag: TagBase } });
const context = createExecutionContext({
  contract,
  stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
});

describe('a char(3) value read through a relation include', () => {
  it(
    'is the value a flat read returns',
    async () => {
      await withPushedContractRuntime(contract, async (runtime) => {
        await runtime.query(`
          insert into char_owners (id) values (1);
          insert into char_tags (id, owner_id, code) values (1, 1, 'a'), (2, 1, 'abc');
        `);
        const namespace = { namespaceId: 'public' };
        const flat = await new Collection({ runtime, context }, 'Tag', namespace)
          .select('id', 'code')
          .orderBy((t) => t['id']!.asc())
          .all();
        const included = await new Collection({ runtime, context }, 'Owner', namespace)
          .select('id')
          .include('tags', (tag) => tag.select('id', 'code').orderBy((t) => t['id']!.asc()))
          .all();

        expect({ flat, included }).toEqual({
          flat: [
            { id: 1, code: 'a' },
            { id: 2, code: 'abc' },
          ],
          included: [{ id: 1, tags: flat }],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
