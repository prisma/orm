import { createHash } from 'node:crypto';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { PostgresRlsEnablement } from '../../src/core/postgres-rls-enablement';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';

const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false };
const text = { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false };

interface Placement {
  /** The namespace of each table, by table name. */
  readonly [table: string]: string;
}

function invoicePolicyEntries(name: string, namespaceId: string, tableName: string) {
  const policy = new PostgresRlsPolicy({
    naming: parseNaming(name, name.replace(/_[0-9a-f]{8}$/, '')),
    tableName,
    namespaceId,
    operation: 'select',
    roles: ['app_user'],
    using: '(id > 0)',
    withCheck: undefined,
    permissive: true,
  });
  return {
    policy: { [policy.name]: policy },
    rls: { [tableName]: new PostgresRlsEnablement({ tableName, namespaceId }) },
  };
}

export function invoiceTable(): StorageTable {
  return new StorageTable({
    columns: { id: int4, number: text },
    primaryKey: { columns: ['id'] },
    uniques: [{ columns: ['number'] }],
    indexes: [],
    foreignKeys: [],
  });
}

/** The invoice table, with a `customerId` column whose foreign key references `customer`. */
function invoiceTableReferencing(
  namespaceId: string,
  customer: { readonly namespace: string; readonly table: string },
): StorageTable {
  return new StorageTable({
    columns: { id: int4, number: text, customerId: int4 },
    primaryKey: { columns: ['id'] },
    uniques: [{ columns: ['number'] }],
    indexes: [],
    foreignKeys: [
      {
        source: { namespaceId, tableName: 'Invoice', columns: ['customerId'] },
        target: { namespaceId: customer.namespace, tableName: customer.table, columns: ['id'] },
      },
    ],
  });
}

function paymentTable(
  paymentNamespace: string,
  invoiceNamespace: string,
  invoiceTableName: string,
): StorageTable {
  return new StorageTable({
    columns: { id: int4, invoiceId: int4 },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [
      {
        source: { namespaceId: paymentNamespace, tableName: 'payment', columns: ['invoiceId'] },
        target: { namespaceId: invoiceNamespace, tableName: invoiceTableName, columns: ['id'] },
      },
    ],
  });
}

export function receiptTable(): StorageTable {
  return new StorageTable({
    columns: { id: int4 },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  });
}

/**
 * A contract with model `Payment` in `public`, whose foreign key references the invoice table, and
 * the invoice model `invoiceModel` in table `invoiceTableName` of `invoiceNamespace`.
 * `extraTables` adds tables with no model.
 */
export function contractWith(options: {
  readonly invoiceNamespace: string;
  readonly paymentNamespace?: string;
  readonly invoiceModel?: string;
  readonly invoiceTableName?: string;
  readonly extraTables?: Readonly<Record<string, { namespace: string; table: StorageTable }>>;
  /** A select policy on the invoice table, by its wire name, with row-level security enabled. */
  readonly invoicePolicy?: string;
  /** A table the invoice table's foreign key references, by its namespace and name. */
  readonly invoiceReferences?: { readonly namespace: string; readonly table: string };
  readonly seed: string;
}): Contract<SqlStorage> {
  const invoiceModel = options.invoiceModel ?? 'Invoice';
  const invoiceTableName = options.invoiceTableName ?? 'Invoice';
  const paymentNamespace = options.paymentNamespace ?? 'public';
  const tables: Record<string, Record<string, StorageTable>> = {
    [paymentNamespace]: {
      payment: paymentTable(paymentNamespace, options.invoiceNamespace, invoiceTableName),
    },
  };
  const add = (namespace: string, name: string, table: StorageTable) => {
    tables[namespace] = { ...tables[namespace], [name]: table };
  };
  add(
    options.invoiceNamespace,
    invoiceTableName,
    options.invoiceReferences === undefined
      ? invoiceTable()
      : invoiceTableReferencing(options.invoiceNamespace, options.invoiceReferences),
  );
  for (const [name, extra] of Object.entries(options.extraTables ?? {})) {
    add(extra.namespace, name, extra.table);
  }
  const placement: Placement = {
    payment: paymentNamespace,
    [invoiceTableName]: options.invoiceNamespace,
  };
  const model = (table: string) => ({
    fields: {},
    relations: {},
    storage: { table, namespaceId: placement[table] ?? paymentNamespace, fields: {} },
  });
  const models: Record<string, Record<string, ReturnType<typeof model>>> = {
    [paymentNamespace]: { Payment: model('payment') },
  };
  models[options.invoiceNamespace] = {
    ...models[options.invoiceNamespace],
    [invoiceModel]: model(invoiceTableName),
  };
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(options.seed),
    storage: new SqlStorage({
      storageHash: coreHash(createHash('sha256').update(options.seed).digest('hex')),
      namespaces: Object.fromEntries(
        Object.entries(tables).map(([id, entries]) => [
          id,
          postgresCreateNamespace({
            id,
            entries: {
              table: entries,
              ...(id === options.invoiceNamespace && options.invoicePolicy !== undefined
                ? invoicePolicyEntries(options.invoicePolicy, id, invoiceTableName)
                : {}),
            },
          }),
        ]),
      ),
    }),
    roots: {},
    domain: {
      namespaces: Object.fromEntries(
        Object.entries(models).map(([id, namespaceModels]) => [id, { models: namespaceModels }]),
      ),
    },
    capabilities: {},
    extensions: {},
    meta: {},
  };
}
