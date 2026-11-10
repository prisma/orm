/**
 * `--rename billing:finance`: a namespace statement renames the schema with `ALTER SCHEMA … RENAME
 * TO` before the rest of the plan, so its tables keep their rows and the diff sees them under the
 * new name. The default schema, `public`, and a schema another contract space declares are refused.
 */
import { asNamespaceId, type Contract } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  planOriginOf,
  type ResolvedNamespaceRenameStatement,
  type SchemaOwnership,
} from '@internal/framework-components/control';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { postgresTypeComponents } from '../postgres-type-lookups';
import { contractWith, receiptTable } from './move-fixtures';
import { stubLowerer } from './rename-table-fixtures';

const ALL_CLASSES = { allowedOperationClasses: ['additive', 'widening', 'destructive'] as const };

function renameNamespace(from: string, to: string): ResolvedNamespaceRenameStatement {
  return { kind: 'rename', entity: 'namespace', from: asNamespaceId(from), to: asNamespaceId(to) };
}

function plan(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  statement: ResolvedNamespaceRenameStatement,
  ownership?: SchemaOwnership,
) {
  return createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: postgresContractToSchema(from, postgresTypeComponents),
    policy: ALL_CLASSES,
    fromContract: from,
    origin: planOriginOf(from),
    statements: [statement],
    frameworkComponents: postgresTypeComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
    ...(ownership === undefined ? {} : { ownership }),
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

const inBilling = contractWith({ invoiceNamespace: 'billing', seed: 'billing' });
const inFinance = contractWith({ invoiceNamespace: 'finance', seed: 'finance' });
const billingToFinance = renameNamespace('billing', 'finance');

describe('Postgres planner, a namespace statement', () => {
  it('renames the schema, and plans nothing for its table or the foreign key that references it', async () => {
    expect(await labelsOf(plan(inBilling, inFinance, billingToFinance))).toEqual([
      'Rename schema "billing" to "finance"',
    ]);
  });

  it('accounts for the rename in the applied statement and renders it as the facade call', () => {
    const result = succeeded(plan(inBilling, inFinance, billingToFinance));

    expect(result.appliedStatements).toEqual([
      { statement: billingToFinance, operationIndexes: [0] },
    ]);
    expect(result.plan.renderTypeScript(keepInternalSpecifiers)).toContain(
      'this.renameSchema({ schema: "billing", to: "finance" })',
    );
  });

  it('renames the schema before the diff, so a table the diff creates in the renamed schema comes after it', async () => {
    const withReceipt = contractWith({
      invoiceNamespace: 'finance',
      extraTables: { receipt: { namespace: 'finance', table: receiptTable() } },
      seed: 'finance-with-receipt',
    });

    expect(await labelsOf(plan(inBilling, withReceipt, billingToFinance))).toEqual([
      'Rename schema "billing" to "finance"',
      'Create table "receipt"',
    ]);
  });

  it('refuses to rename public, and says to move the models instead', () => {
    const inPublic = contractWith({ invoiceNamespace: 'public', seed: 'public' });
    const moved = contractWith({
      invoiceNamespace: 'finance',
      paymentNamespace: 'finance',
      seed: 'moved',
    });

    const result = plan(inPublic, moved, renameNamespace('public', 'finance'));

    expect(result.kind === 'failure' && result.conflicts).toEqual([
      expect.objectContaining({
        kind: 'statementRefused',
        summary:
          'Cannot rename namespace "public" to "finance": "public" is the default schema of every Postgres database',
        why: 'Prisma owns schema "public", and Postgres puts it on every search path, so a migration does not rename it. Move each model to the new namespace with --rename <Model>:finance.<Model> instead.',
      }),
    ]);
  });

  it('refuses to rename a schema another contract space declares, naming the space', () => {
    const ownership: SchemaOwnership = {
      declaresEntity: () => false,
      namespaceDeclaringSpaces: (namespaceId) =>
        namespaceId === 'billing' ? [APP_SPACE_ID, 'ledger'] : [APP_SPACE_ID],
    };

    const result = plan(inBilling, inFinance, billingToFinance, ownership);

    expect(result.kind === 'failure' && result.conflicts).toEqual([
      expect.objectContaining({
        kind: 'statementRefused',
        summary:
          'Cannot rename namespace "billing" to "finance": contract space "ledger" also declares it',
        why: 'Renaming the namespace would rename it under contract space "ledger" too, whose contract still names it "billing". Leave out this statement, or move each model with --rename billing.<Model>:finance.<Model> instead.',
      }),
    ]);
  });

  it('refuses a rename to public, and says to move the models instead', () => {
    const inPublic = contractWith({ invoiceNamespace: 'public', seed: 'public' });

    const result = plan(inBilling, inPublic, renameNamespace('billing', 'public'));

    expect(result.kind === 'failure' && result.conflicts).toEqual([
      expect.objectContaining({
        kind: 'statementRefused',
        summary:
          'Cannot rename namespace "billing" to "public": "public" is the default schema of every Postgres database',
        why: 'Every Postgres database already has schema "public", so no schema can be renamed to it. Move each model with --rename billing.<Model>:<Model> instead.',
      }),
    ]);
  });

  it('renames into a name the database lacks although the read schema lists it with no tables', async () => {
    const schema = postgresContractToSchema(inBilling, postgresTypeComponents);
    const withPlaceholder = new PostgresDatabaseSchemaNode({
      extensions: undefined,
      namespaces: {
        ...schema.namespaces,
        finance: new PostgresNamespaceSchemaNode({ schemaName: 'finance', tables: {} }),
      },
      roles: schema.roles,
      existingSchemas: schema.existingSchemas,
      pgVersion: schema.pgVersion,
    });

    const result = createPostgresMigrationPlanner(stubLowerer).plan({
      contract: inFinance,
      schema: withPlaceholder,
      policy: ALL_CLASSES,
      fromContract: inBilling,
      origin: planOriginOf(inBilling),
      statements: [billingToFinance],
      frameworkComponents: postgresTypeComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(await labelsOf(result)).toEqual(['Rename schema "billing" to "finance"']);
  });
});
