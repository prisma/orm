/**
 * `this.setTableSchema` in a hand-written migration moves the table in the migration's working
 * schema too, so a later rename call finds the table in its new schema.
 */
import type { Contract } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type { ControlStack } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { PostgresMigration } from '../../src/core/migrations/postgres-migration';
import { PostgresContractSerializer } from '../../src/core/postgres-contract-serializer';
import { postgresTypeComponents } from '../postgres-type-lookups';
import { contractWith } from './move-fixtures';
import { stubLowerer } from './rename-table-fixtures';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;
type ContractJson = { readonly storage: { readonly storageHash: string } };

const stack = {
  adapter: {
    ...postgresTypeComponents[0],
    create: () => stubLowerer as unknown as SqlControlAdapter<'postgres'>,
  },
  target: { kind: 'target', familyId: 'sql', targetId: 'postgres' },
  extensions: [],
} as unknown as ControlStack<'sql', 'postgres'>;

function jsonOf(contract: Contract<SqlStorage>): ContractJson {
  return new PostgresContractSerializer().serializeContract(contract) as unknown as ContractJson;
}

describe('this.setTableSchema', () => {
  it('moves the table for the rename calls after it, which find it in its new schema', async () => {
    const start = jsonOf(contractWith({ invoiceNamespace: 'public', seed: 'start' }));
    const end = jsonOf(
      contractWith({
        invoiceNamespace: 'billing',
        invoiceModel: 'Bill',
        invoiceTableName: 'Bill',
        seed: 'end',
      }),
    );
    class MoveThenRename extends PostgresMigration {
      override readonly startContractJson = start;
      override readonly endContractJson = end;
      override get operations(): readonly Promise<Op>[] {
        return [
          this.setTableSchema({ schema: 'public', table: 'Invoice', to: 'billing' }),
          ...this.renameTable({ schema: 'billing', table: 'Invoice', to: 'Bill' }),
        ];
      }
    }

    const ops = await Promise.all(new MoveThenRename(stack).operations);

    expect(ops.map((op) => op.label)).toEqual([
      'Move table "Invoice" to schema "billing"',
      'Rename table "Invoice" to "Bill"',
      'Rename primary key "Invoice_pkey" to "Bill_pkey" on "Bill"',
      'Rename unique constraint "Invoice_number_key" to "Bill_number_key" on "Bill"',
    ]);
  });

  it('this.renameSchema renames the schema for the rename calls after it', async () => {
    const start = jsonOf(contractWith({ invoiceNamespace: 'billing', seed: 'billing-start' }));
    const end = jsonOf(
      contractWith({
        invoiceNamespace: 'finance',
        invoiceModel: 'Bill',
        invoiceTableName: 'Bill',
        seed: 'finance-end',
      }),
    );
    class RenameSchemaThenTable extends PostgresMigration {
      override readonly startContractJson = start;
      override readonly endContractJson = end;
      override get operations(): readonly Promise<Op>[] {
        return [
          this.renameSchema({ schema: 'billing', to: 'finance' }),
          ...this.renameTable({ schema: 'finance', table: 'Invoice', to: 'Bill' }),
        ];
      }
    }

    const ops = await Promise.all(new RenameSchemaThenTable(stack).operations);

    expect(ops.map((op) => op.label)).toEqual([
      'Rename schema "billing" to "finance"',
      'Rename table "Invoice" to "Bill"',
      'Rename primary key "Invoice_pkey" to "Bill_pkey" on "Bill"',
      'Rename unique constraint "Invoice_number_key" to "Bill_number_key" on "Bill"',
    ]);
  });
});
