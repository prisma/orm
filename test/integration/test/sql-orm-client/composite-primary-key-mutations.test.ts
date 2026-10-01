import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';
import type { SqlStorage } from '@internal/sql-contract/types';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { authorSqlContractFromPsl } from '../scalar-lists/psl-list-authoring';
import { timeouts, withPushedContractRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

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

const vehiclesSchema = `
model Vehicle {
  tenantId Int    @map("tenant_id")
  id       Int
  kind     String
  name     String

  @@id([tenantId, id])
  @@discriminator(kind)
  @@map("cpk_vehicles")
}

model Truck {
  payload Int

  @@base(Vehicle, "truck")
  @@map("cpk_trucks")
}
`;

async function authorVehiclesContract(): Promise<Contract<SqlStorage>> {
  const authored = await authorSqlContractFromPsl(vehiclesSchema);
  expect(authored.diagnostics).toEqual([]);
  return authored.contract!;
}

async function withVehicles(
  fn: (
    vehicles: Collection<Contract<SqlStorage>, string>,
    runtime: PgIntegrationRuntime,
  ) => Promise<void>,
): Promise<void> {
  const contract = await authorVehiclesContract();
  const context = createExecutionContext({
    contract,
    stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
  });
  await withPushedContractRuntime(contract, async (runtime) => {
    await fn(new Collection({ runtime, context }, 'Vehicle', { namespaceId: 'public' }), runtime);
  });
}

async function seedTrucks(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query(`
    insert into cpk_vehicles (tenant_id, id, kind, name)
    values (1, 1, 'truck', 'Hauler'), (1, 2, 'truck', 'Tipper'), (2, 1, 'truck', 'Mover')
  `);
  await runtime.query(`
    insert into cpk_trucks (tenant_id, id, payload)
    values (1, 1, 5), (1, 2, 9), (2, 1, 5)
  `);
}

async function readTrucks(vehicles: Collection<Contract<SqlStorage>, string>) {
  return vehicles
    .variant('Truck' as never)
    .select('tenantId', 'id', 'name', 'payload')
    .orderBy([(v) => v['tenantId']!.asc(), (v) => v['id']!.asc()])
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

  it(
    'an MTI variant read joins its table on every primary-key column',
    async () => {
      await withVehicles(async (vehicles, runtime) => {
        await seedTrucks(runtime);

        expect(await readTrucks(vehicles)).toEqual([
          { tenantId: 1, id: 1, name: 'Hauler', payload: 5 },
          { tenantId: 1, id: 2, name: 'Tipper', payload: 9 },
          { tenantId: 2, id: 1, name: 'Mover', payload: 5 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an MTI variant create writes every primary-key column to the variant table',
    async () => {
      await withVehicles(async (vehicles, runtime) => {
        await seedTrucks(runtime);

        const created = await vehicles
          .variant('Truck' as never)
          .create({ tenantId: 1, id: 3, name: 'Loader', payload: 7 } as never);

        expect(created).toEqual({ tenantId: 1, id: 3, kind: 'truck', name: 'Loader', payload: 7 });
        expect(await readTrucks(vehicles)).toEqual([
          { tenantId: 1, id: 1, name: 'Hauler', payload: 5 },
          { tenantId: 1, id: 2, name: 'Tipper', payload: 9 },
          { tenantId: 1, id: 3, name: 'Loader', payload: 7 },
          { tenantId: 2, id: 1, name: 'Mover', payload: 5 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'updateAndCount() on an MTI variant changes only the matching rows',
    async () => {
      await withVehicles(async (vehicles, runtime) => {
        await seedTrucks(runtime);

        const count = await vehicles
          .variant('Truck' as never)
          .where((v) => v['payload']!.eq(9))
          .updateAndCount({ name: 'Renamed' } as never);

        expect(count).toBe(1);
        expect(await readTrucks(vehicles)).toEqual([
          { tenantId: 1, id: 1, name: 'Hauler', payload: 5 },
          { tenantId: 1, id: 2, name: 'Renamed', payload: 9 },
          { tenantId: 2, id: 1, name: 'Mover', payload: 5 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'deleteAndCount() on an MTI variant deletes only the matching rows',
    async () => {
      await withVehicles(async (vehicles, runtime) => {
        await seedTrucks(runtime);

        const count = await vehicles
          .variant('Truck' as never)
          .where((v) => v['payload']!.eq(9))
          .deleteAndCount();

        expect(count).toBe(1);
        expect(await readTrucks(vehicles)).toEqual([
          { tenantId: 1, id: 1, name: 'Hauler', payload: 5 },
          { tenantId: 2, id: 1, name: 'Mover', payload: 5 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
