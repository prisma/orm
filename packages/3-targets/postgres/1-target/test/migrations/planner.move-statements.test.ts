/**
 * `--rename Invoice:billing.Invoice`: a model statement whose namespace changes moves the model's
 * table to the destination schema with `ALTER TABLE … SET SCHEMA`, creating the schema first when
 * the database lacks it, instead of dropping the table and creating it again.
 */
import { asNamespaceId, type Contract } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
  type ResolvedModelRenameStatement,
} from '@internal/framework-components/control';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import type { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { postgresTypeComponents } from '../postgres-type-lookups';
import { contractWith, invoiceTable, receiptTable } from './move-fixtures';
import { stubLowerer } from './rename-table-fixtures';

const ALL_CLASSES = { allowedOperationClasses: ['additive', 'widening', 'destructive'] as const };
function moveStatement(
  fromNamespace: string,
  toNamespace: string,
  toModel = 'Invoice',
): ResolvedModelRenameStatement {
  return {
    kind: 'rename',
    entity: 'model',
    from: { namespaceId: asNamespaceId(fromNamespace), model: 'Invoice' },
    to: { namespaceId: asNamespaceId(toNamespace), model: toModel },
  };
}

function plan(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  statement: ResolvedModelRenameStatement,
  schema: PostgresDatabaseSchemaNode = postgresContractToSchema(from, postgresTypeComponents),
  policy: MigrationOperationPolicy = ALL_CLASSES,
) {
  return createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema,
    policy,
    fromContract: from,
    origin: planOriginOf(from),
    statements: [statement],
    frameworkComponents: postgresTypeComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
}

function succeeded(result: ReturnType<typeof plan>) {
  if (result.kind !== 'success') {
    throw new Error(`expected a plan, got ${JSON.stringify(result.conflicts)}`);
  }
  return result;
}

async function labelsOf(result: ReturnType<typeof plan>): Promise<readonly string[]> {
  const ops = await Promise.all(succeeded(result).plan.operations);
  return ops.map((op) => op.label);
}

const inPublic = contractWith({ invoiceNamespace: 'public', seed: 'from' });
const inBilling = contractWith({ invoiceNamespace: 'billing', seed: 'to' });

describe('Postgres planner, a model statement that moves the table to another namespace', () => {
  it('creates the schema, then moves the table, and plans nothing for the foreign key that references it', async () => {
    const result = plan(inPublic, inBilling, moveStatement('public', 'billing'));

    expect(await labelsOf(result)).toEqual([
      'Create schema "billing"',
      'Move table "Invoice" to schema "billing"',
    ]);
  });

  it('accounts for the move in the applied statement, not the creation of the schema', () => {
    const statement = moveStatement('public', 'billing');

    expect(succeeded(plan(inPublic, inBilling, statement)).appliedStatements).toEqual([
      { statement, operationIndexes: [1] },
    ]);
  });

  it('only moves the table when the database already has the schema', async () => {
    const withBilling = contractWith({
      invoiceNamespace: 'public',
      extraTables: { receipt: { namespace: 'billing', table: receiptTable() } },
      seed: 'from-with-billing',
    });
    const target = contractWith({
      invoiceNamespace: 'billing',
      extraTables: { receipt: { namespace: 'billing', table: receiptTable() } },
      seed: 'to-with-billing',
    });

    expect(await labelsOf(plan(withBilling, target, moveStatement('public', 'billing')))).toEqual([
      'Move table "Invoice" to schema "billing"',
    ]);
  });

  it('runs the move before the diff, so a table the diff creates in the new schema comes after it', async () => {
    const target = contractWith({
      invoiceNamespace: 'billing',
      extraTables: { receipt: { namespace: 'billing', table: receiptTable() } },
      seed: 'to-with-receipt',
    });

    expect(await labelsOf(plan(inPublic, target, moveStatement('public', 'billing')))).toEqual([
      'Create schema "billing"',
      'Move table "Invoice" to schema "billing"',
      'Create table "receipt"',
    ]);
  });

  it('moves the table, then renames it and its derived constraint names in the new schema', async () => {
    const target = contractWith({
      invoiceNamespace: 'billing',
      invoiceModel: 'Bill',
      invoiceTableName: 'Bill',
      seed: 'to-bill',
    });

    expect(
      await labelsOf(plan(inPublic, target, moveStatement('public', 'billing', 'Bill'))),
    ).toEqual([
      'Create schema "billing"',
      'Move table "Invoice" to schema "billing"',
      'Rename table "Invoice" to "Bill"',
      'Rename primary key "Invoice_pkey" to "Bill_pkey" on "Bill"',
      'Rename unique constraint "Invoice_number_key" to "Bill_number_key" on "Bill"',
    ]);
  });

  it('renders the move as the facade call a hand-written migration makes', () => {
    const migration = succeeded(plan(inPublic, inBilling, moveStatement('public', 'billing'))).plan;

    expect(migration.renderTypeScript(keepInternalSpecifiers)).toContain(
      'this.setTableSchema({ schema: "public", table: "Invoice", to: "billing" })',
    );
  });

  it('moves a table of the unbound namespace, leaving its source schema to the search path', async () => {
    const fromUnbound = contractWith({
      invoiceNamespace: UNBOUND_NAMESPACE_ID,
      paymentNamespace: UNBOUND_NAMESPACE_ID,
      seed: 'unbound',
    });
    const toBilling = contractWith({
      invoiceNamespace: 'billing',
      paymentNamespace: UNBOUND_NAMESPACE_ID,
      seed: 'unbound-to-billing',
    });
    const result = plan(fromUnbound, toBilling, moveStatement(UNBOUND_NAMESPACE_ID, 'billing'));

    expect(await labelsOf(result)).toEqual([
      'Create schema "billing"',
      'Move table "Invoice" to schema "billing"',
    ]);
    expect(succeeded(result).plan.renderTypeScript(keepInternalSpecifiers)).toContain(
      'this.setTableSchema({ table: "Invoice", to: "billing" })',
    );
  });

  it('drops a policy the destination removes in the schema the table moved to', () => {
    const from = contractWith({
      invoiceNamespace: 'public',
      invoicePolicy: 'invoice_read_ab12cd34',
      seed: 'policy-from',
    });
    const migration = succeeded(plan(from, inBilling, moveStatement('public', 'billing'))).plan;

    expect(
      migration
        .renderTypeScript(keepInternalSpecifiers)
        .split('\n')
        .filter((line) => line.includes('RlsPolicy')),
    ).toEqual([
      expect.stringContaining(
        'this.dropRlsPolicy({ schema: "billing", table: "Invoice", policy: "invoice_read_ab12cd34" })',
      ),
    ]);
  });

  it('renames a policy whose name the destination changes, in the schema the table moved to', () => {
    const from = contractWith({
      invoiceNamespace: 'public',
      invoicePolicy: 'invoice_read_ab12cd34',
      seed: 'policy-rename-from',
    });
    const to = contractWith({
      invoiceNamespace: 'billing',
      invoicePolicy: 'invoice_select_ab12cd34',
      seed: 'policy-rename-to',
    });
    const migration = succeeded(plan(from, to, moveStatement('public', 'billing'))).plan;

    expect(
      migration
        .renderTypeScript(keepInternalSpecifiers)
        .split('\n')
        .filter((line) => line.includes('RlsPolicy')),
    ).toEqual([
      expect.stringContaining(
        'this.renameRlsPolicy({ schema: "billing", table: "Invoice", from: "invoice_read_ab12cd34", to: "invoice_select_ab12cd34" })',
      ),
    ]);
  });

  it('refuses a move onto a table the destination schema already has', () => {
    const occupied = contractWith({
      invoiceNamespace: 'public',
      extraTables: { Invoice: { namespace: 'billing', table: invoiceTable() } },
      seed: 'occupied',
    });

    const result = plan(occupied, inBilling, moveStatement('public', 'billing'));

    expect(result.kind === 'failure' && result.conflicts).toEqual([
      expect.objectContaining({
        kind: 'statementRefused',
        summary:
          'Cannot move table "Invoice" from namespace "public" to namespace "billing": the schema being planned from already has a table "billing.Invoice"',
      }),
    ]);
  });
});

describe('Postgres planner, a moved table whose foreign key references a table that stays', () => {
  const customer = { namespace: 'billing', table: 'customer' };
  const extraTables = { customer: { namespace: 'billing', table: receiptTable() } };
  const from = contractWith({
    invoiceNamespace: 'billing',
    invoiceReferences: customer,
    extraTables,
    seed: 'references-from',
  });
  const to = contractWith({
    invoiceNamespace: 'finance',
    invoiceReferences: customer,
    extraTables,
    seed: 'references-to',
  });

  it('moves the table and plans nothing for its foreign key, which still references the table in the source schema', async () => {
    expect(await labelsOf(plan(from, to, moveStatement('billing', 'finance')))).toEqual([
      'Create schema "finance"',
      'Move table "Invoice" to schema "finance"',
    ]);
  });
});
