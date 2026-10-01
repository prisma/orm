import { charColumn, int4Column } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { timeouts, withPushedContractRuntime } from './integration-helpers';

const OwnerBase = model('Owner', {
  fields: {
    id: field.column(int4Column).id(),
    code: field.column(charColumn(3)),
  },
}).sql({ table: 'char_owners' });

const Tag = model('Tag', {
  fields: {
    id: field.column(int4Column).id(),
    ownerId: field.column(int4Column).column('owner_id'),
    code: field.column(charColumn(3)),
  },
  relations: { owner: rel.belongsTo(OwnerBase, { from: 'ownerId', to: 'id' }) },
}).sql({ table: 'char_tags' });

const Owner = OwnerBase.relations({
  tags: rel.hasMany(() => Tag, { by: 'ownerId' }),
}).sql({ table: 'char_owners' });

const contract = defineContract({ models: { Owner, Tag } });
const context = createExecutionContext({
  contract,
  stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
});

describe('a char(3) value', () => {
  it(
    'reads the same through a flat read, a to-many include and a to-one include, losing only the padding',
    async () => {
      await withPushedContractRuntime(contract, async (runtime) => {
        await runtime.query(`
          insert into char_owners (id, code) values (1, 'a'), (2, E'a\\t'), (3, 'abc');
          insert into char_tags (id, owner_id, code) values (1, 1, 'a'), (2, 2, E'a\\t'), (3, 3, 'abc');
        `);
        const namespace = { namespaceId: 'public' };
        const flat = await new Collection({ runtime, context }, 'Owner', namespace)
          .select('id', 'code')
          .orderBy((o) => o['id']!.asc())
          .all();
        const toMany = await new Collection({ runtime, context }, 'Owner', namespace)
          .select('id')
          .include('tags', (tag) => tag.select('id', 'code'))
          .orderBy((o) => o['id']!.asc())
          .all();
        const toOne = await new Collection({ runtime, context }, 'Tag', namespace)
          .select('id')
          .include('owner', (owner) => owner.select('id', 'code'))
          .orderBy((t) => t['id']!.asc())
          .all();

        expect({ flat, toMany, toOne }).toEqual({
          flat: [
            { id: 1, code: 'a' },
            { id: 2, code: 'a\t' },
            { id: 3, code: 'abc' },
          ],
          toMany: flat.map(({ id, code }) => ({ id, tags: [{ id, code }] })),
          toOne: flat.map(({ id, code }) => ({ id, owner: { id, code } })),
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
