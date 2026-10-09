/**
 * Storage no model maps stays out of every ORM read and write: `users.legacy_key` and `posts.internal_note` are columns the contract's tables hold but no field maps. They come from table nodes in the contract definition, so the database built from the contract has them.
 */
import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import sqlFamilyPack from '@internal/family-sql/pack';
import { assembleDataTypes } from '@internal/framework-components/codec';
import { field, model, rel } from '@internal/postgres/contract-builder';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  buildContractDefinition,
  buildSqlContractFromDefinition,
  type ModelLike,
  type TableNode,
} from '@internal/sql-contract-ts/contract-builder';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import { assemblePostgresCodecRegistryWithBuiltins } from '@internal/target-postgres/codecs';
import postgresPack from '@internal/target-postgres/pack';
import postgresTarget from '@internal/target-postgres/runtime';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';
import { timeouts, withPushedContractRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

function defineContractWithTables(
  models: Record<string, ModelLike>,
  tables: readonly TableNode[],
): Contract<SqlStorage> {
  const dataTypeLookup = assembleDataTypes([postgresPack]).lookup;
  const codecLookup = assemblePostgresCodecRegistryWithBuiltins([], dataTypeLookup);
  const definition = buildContractDefinition({
    family: sqlFamilyPack,
    target: postgresPack,
    createNamespace: postgresCreateNamespace,
    models,
  });
  return buildSqlContractFromDefinition({ ...definition, tables }, codecLookup, dataTypeLookup);
}

const UserBase = model('User', {
  fields: {
    id: field.column(int4Column).id(),
    email: field.column(textColumn),
  },
}).sql({ table: 'unmapped_users' });

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).id(),
    title: field.column(textColumn),
    userId: field.column(int4Column).column('user_id'),
  },
  relations: { author: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }) },
}).sql({ table: 'unmapped_posts' });

const User = UserBase.relations({
  posts: rel.hasMany(() => Post, { by: 'userId' }),
}).sql({ table: 'unmapped_users' });

const extraText = { descriptor: { codecId: 'pg/text@1' }, nullable: true };

const contract = defineContractWithTables({ User, Post }, [
  { tableName: 'unmapped_users', columns: [{ columnName: 'legacy_key', ...extraText }] },
  { tableName: 'unmapped_posts', columns: [{ columnName: 'internal_note', ...extraText }] },
]);
const context = createExecutionContext({
  contract,
  stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
});

interface LooseCollection {
  where(filter: unknown): LooseCollection;
  select(...fields: string[]): LooseCollection;
  include(relation: string): LooseCollection;
  orderBy(order: (row: Record<string, { asc(): unknown }>) => unknown): LooseCollection;
  all(): Promise<unknown[]>;
  create(data: Record<string, unknown>): Promise<unknown>;
}

function collection(runtime: PgIntegrationRuntime, modelName: 'User' | 'Post'): LooseCollection {
  return new Collection({ runtime, context } as never, modelName, {
    namespaceId: 'public',
  }) as unknown as LooseCollection;
}

async function seed(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query(`
    insert into unmapped_users (id, email, legacy_key) values (1, 'alice@example.com', 'secret');
    insert into unmapped_posts (id, title, user_id, internal_note) values (10, 'Hello', 1, 'flagged');
  `);
}

function unmappedColumnPassed(model: string, table: string, column: string) {
  return expect.objectContaining({
    code: 'ORM.FIELD_UNKNOWN',
    message: `Model "${model}" has no field "${column}". Table "${table}" has a column "${column}" that no field maps, so the ORM cannot read or write it.`,
  });
}

describe('storage no model maps', () => {
  it(
    'is not read by a query with no select, an include or a create',
    async () => {
      await withPushedContractRuntime(contract, async (runtime) => {
        await seed(runtime);

        expect(await collection(runtime, 'User').all()).toEqual([
          { id: 1, email: 'alice@example.com' },
        ]);
        expect(await collection(runtime, 'User').include('posts').all()).toEqual([
          {
            id: 1,
            email: 'alice@example.com',
            posts: [{ id: 10, title: 'Hello', userId: 1 }],
          },
        ]);
        expect(
          await collection(runtime, 'Post').create({ id: 11, title: 'Next', userId: 1 }),
        ).toEqual({ id: 11, title: 'Next', userId: 1 });

        expect(await runtime.query('select legacy_key from unmapped_users where id = 1')).toEqual([
          { legacy_key: 'secret' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'cannot be named in a create, a where or a select',
    async () => {
      await withPushedContractRuntime(contract, async (runtime) => {
        await seed(runtime);
        const users = () => collection(runtime, 'User');

        await expect(
          (async () => users().create({ id: 2, email: 'b@example.com', legacy_key: 'x' }))(),
        ).rejects.toEqual(unmappedColumnPassed('User', 'unmapped_users', 'legacy_key'));
        await expect((async () => users().where({ legacy_key: 'secret' }).all())()).rejects.toEqual(
          unmappedColumnPassed('User', 'unmapped_users', 'legacy_key'),
        );
        await expect(
          (async () =>
            users()
              .where((user: Record<string, { eq(value: string): unknown }>) =>
                user['legacy_key']!.eq('secret'),
              )
              .all())(),
        ).rejects.toEqual(unmappedColumnPassed('User', 'unmapped_users', 'legacy_key'));
        await expect((async () => users().select('legacy_key').all())()).rejects.toEqual(
          unmappedColumnPassed('User', 'unmapped_users', 'legacy_key'),
        );

        expect(await runtime.query('select count(*)::int as n from unmapped_users')).toEqual([
          { n: 1 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
