import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { timeouts, withPushedContractRuntime } from './integration-helpers';

const AccountBase = model('Account', {
  fields: {
    tenantId: field.column(int4Column).column('tenant_id'),
    id: field.column(int4Column),
    name: field.column(textColumn),
  },
}).attributes(({ fields, constraints }) => ({
  id: constraints.id([fields.tenantId, fields.id]),
}));

const Note = model('Note', {
  fields: {
    id: field.column(int4Column).id(),
    tenantId: field.column(int4Column).column('tenant_id'),
    accountId: field.column(int4Column).column('account_id'),
    body: field.column(textColumn),
  },
  relations: {
    account: rel.belongsTo(AccountBase, {
      from: ['tenantId', 'accountId'],
      to: ['tenantId', 'id'],
    }),
  },
}).sql({ table: 'cpk_notes' });

const Account = AccountBase.relations({
  notes: rel.hasMany(() => Note, { by: ['tenantId', 'accountId'] }),
}).sql({ table: 'cpk_accounts' });

const accountsContract = defineContract({ models: { Account, Note } });
const accountsContext = createExecutionContext({
  contract: accountsContract,
  stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
});

type Accounts = Collection<typeof accountsContract, 'Account'>;

async function withAccounts(fn: (accounts: Accounts) => Promise<void>): Promise<void> {
  await withPushedContractRuntime(accountsContract, async (runtime) => {
    await runtime.query(`
      insert into cpk_accounts (tenant_id, id, name)
      values (1, 1, 'Ada'), (1, 2, 'Grace'), (2, 2, 'Barbara')
    `);
    await fn(
      new Collection({ runtime, context: accountsContext }, 'Account', { namespaceId: 'public' }),
    );
  });
}

async function readAccounts(accounts: Accounts) {
  return accounts
    .select('tenantId', 'id', 'name')
    .orderBy([(account) => account.tenantId.asc(), (account) => account.id.asc()])
    .include('notes', (note) => note.select('id', 'body').orderBy((n) => n['id']!.asc()))
    .all();
}

describe('integration/mutations on a composite primary key', () => {
  it(
    'a nested update changes and returns only the matched row',
    async () => {
      await withAccounts(async (accounts) => {
        const updated = await accounts
          .select('tenantId', 'id', 'name')
          .where({ tenantId: 1, id: 2 })
          .update({
            name: 'Grace Hopper',
            notes: (notes) => notes.create([{ id: 20, body: 'compiler' }]),
          });

        expect(updated).toEqual({ tenantId: 1, id: 2, name: 'Grace Hopper' });
        expect(await readAccounts(accounts)).toEqual([
          { tenantId: 1, id: 1, name: 'Ada', notes: [] },
          { tenantId: 1, id: 2, name: 'Grace Hopper', notes: [{ id: 20, body: 'compiler' }] },
          { tenantId: 2, id: 2, name: 'Barbara', notes: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested update of a relation only reloads the matched row',
    async () => {
      await withAccounts(async (accounts) => {
        const updated = await accounts
          .select('tenantId', 'id', 'name')
          .where({ tenantId: 1, id: 2 })
          .update({ notes: (notes) => notes.create([{ id: 21, body: 'cobol' }]) });

        expect(updated).toEqual({ tenantId: 1, id: 2, name: 'Grace' });
        expect(await readAccounts(accounts)).toEqual([
          { tenantId: 1, id: 1, name: 'Ada', notes: [] },
          { tenantId: 1, id: 2, name: 'Grace', notes: [{ id: 21, body: 'cobol' }] },
          { tenantId: 2, id: 2, name: 'Barbara', notes: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested create reloads the created row',
    async () => {
      await withAccounts(async (accounts) => {
        const created = await accounts.select('tenantId', 'id', 'name').create({
          tenantId: 1,
          id: 3,
          name: 'Edsger',
          notes: (notes) => notes.create([{ id: 22, body: 'goto' }]),
        });

        expect(created).toEqual({ tenantId: 1, id: 3, name: 'Edsger' });
        expect(await readAccounts(accounts)).toEqual([
          { tenantId: 1, id: 1, name: 'Ada', notes: [] },
          { tenantId: 1, id: 2, name: 'Grace', notes: [] },
          { tenantId: 1, id: 3, name: 'Edsger', notes: [{ id: 22, body: 'goto' }] },
          { tenantId: 2, id: 2, name: 'Barbara', notes: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
