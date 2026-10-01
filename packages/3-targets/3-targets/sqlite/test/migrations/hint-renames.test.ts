import type { Contract } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID, type ControlStack } from '@internal/framework-components/control';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { RenameTableCall } from '../../src/core/migrations/op-factory-call';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import type { SqlitePlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { renderCallsToTypeScript } from '../../src/core/migrations/render-typescript';
import { SqliteMigration } from '../../src/core/migrations/sqlite-migration';
import { SqliteContractSerializer } from '../../src/core/sqlite-contract-serializer';
import {
  contractOf,
  HANDLE_INDEX_HASH,
  handleIndex,
  type ProfileSpec,
  plainTable,
  reference,
  stubLowerer,
} from './rename-table-fixtures';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;
type ContractJson = { readonly storage: { readonly storageHash: string } };

const EVERY_CLASS = { allowedOperationClasses: ['additive', 'widening', 'destructive'] } as const;
const DESTINATION_HASH = 'b'.repeat(64);
const OLD_INDEX = `userProfile_handle_idx_${HANDLE_INDEX_HASH}`;
const NEW_INDEX = `UserProfile_handle_idx_${HANDLE_INDEX_HASH}`;

const derivedIndex: ProfileSpec = {
  uniques: [{ columns: ['email'] }],
  foreignKeys: (tableName) => [
    { source: reference(tableName, ['accountId']), target: reference('account', ['id']) },
  ],
  indexes: (tableName) => [handleIndex(tableName)],
};

function destination(was = 'userProfile'): Contract<SqlStorage> {
  return {
    ...contractOf('UserProfile', derivedIndex, DESTINATION_HASH),
    hints: {
      namespaces: { [UNBOUND_NAMESPACE_ID]: { tables: { UserProfile: { was } } } },
    },
  };
}

const startContract = contractOf('userProfile', derivedIndex, 'from');

/** The origin as introspection reports it: the index carries its full name, not a prefix. */
const introspectedOrigin = sqliteContractToSchema(
  contractOf(
    'userProfile',
    {
      ...derivedIndex,
      indexes: (tableName) => [
        { ...handleIndex(tableName), naming: { kind: 'exact', name: OLD_INDEX } },
      ],
    },
    'from',
  ),
);

function plan(contract: Contract<SqlStorage>, schema: SqlSchemaIR = introspectedOrigin) {
  return createSqliteMigrationPlanner(stubLowerer).plan({
    contract,
    schema,
    policy: EVERY_CLASS,
    fromContract: null,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
}

function planned(contract: Contract<SqlStorage>, schema: SqlSchemaIR = introspectedOrigin) {
  const result = plan(contract, schema);
  if (result.kind !== 'success') {
    throw new Error(`expected a plan, got ${JSON.stringify(result.conflicts)}`);
  }
  return result;
}

const stack = {
  adapter: { create: () => stubLowerer as unknown as SqlControlAdapter<'sqlite'> },
  target: { kind: 'target', familyId: 'sql', targetId: 'sqlite' },
  extensions: [],
} as unknown as ControlStack<'sql', 'sqlite'>;

function jsonOf(contract: Contract<SqlStorage>): ContractJson {
  return new SqliteContractSerializer().serializeContract(contract) as unknown as ContractJson;
}

async function handWrittenOps(): Promise<readonly Op[]> {
  const startJson = jsonOf(startContract);
  const endJson = jsonOf(destination());
  class HandWritten extends SqliteMigration {
    override readonly startContractJson = startJson;
    override readonly endContractJson = endJson;
    override get operations(): readonly Promise<Op>[] {
      return [...this.renameTable({ table: 'userProfile', to: 'UserProfile' })];
    }
  }
  return Promise.all(new HandWritten(stack).operations);
}

describe('planning a table rename from a hint', () => {
  it('plans exactly the operations of the hand-written renameTable call', async () => {
    const ops = await Promise.all(planned(destination()).plan.operations);
    const expected = await handWrittenOps();

    expect(ops.map((op) => op.label)).toEqual([
      'Rename table userProfile to UserProfile',
      `Drop index ${OLD_INDEX} on UserProfile`,
      `Create index ${NEW_INDEX} on UserProfile`,
    ]);
    expect(ops).toEqual(expected);
  });

  it('renders the migration as the hand-written one, with only the facade call', () => {
    const rendered = planned(destination()).plan.renderTypeScript(keepInternalSpecifiers);

    expect(rendered).toBe(
      renderCallsToTypeScript([new RenameTableCall('userProfile', 'UserProfile', [])], {
        from: null,
        to: DESTINATION_HASH,
        snapshotsImportPath: '../../snapshots',
        resolveImportSpecifier: keepInternalSpecifiers,
      }),
    );
    expect(rendered).toContain('...this.renameTable({ table: "userProfile", to: "UserProfile" })');
  });

  it('reports the hint it consumed, and no warnings', () => {
    const result = planned(destination());

    expect(result.plan.consumedHints).toEqual([
      {
        kind: 'renamed',
        coordinate: {
          namespaceId: UNBOUND_NAMESPACE_ID,
          entityKind: 'table',
          entityName: 'UserProfile',
        },
        from: 'userProfile',
      },
    ]);
    expect(result).not.toHaveProperty('warnings');
  });

  it('renames through a temporary name, since only the case changes', async () => {
    const [rename] = await Promise.all(planned(destination()).plan.operations);

    expect(rename?.execute.map((step) => step.sql)).toEqual([
      'ALTER TABLE "userProfile" RENAME TO "_prisma_rename_UserProfile"',
      'ALTER TABLE "_prisma_rename_UserProfile" RENAME TO "UserProfile"',
    ]);
  });

  it('never reaches the table-name case guard for a hinted case-only rename', () => {
    expect(plan(destination()).kind).toBe('success');
  });

  it('plans nothing for a spent hint', async () => {
    const spent = sqliteContractToSchema(destination());
    const result = planned(destination(), spent);

    expect(await Promise.all(result.plan.operations)).toEqual([]);
    expect(result.plan.consumedHints).toEqual([]);
  });

  it('plans the new table and consumes nothing when the old table is absent', async () => {
    const empty = sqliteContractToSchema(contractOf('account_only', {}, 'empty'));
    const ids = (await Promise.all(planned(destination(), empty).plan.operations)).map(
      (op) => op.id,
    );

    expect(ids).not.toContain('renameTable.userProfile');
    expect(ids).toContain('table.UserProfile');
    expect(planned(destination(), empty).plan.consumedHints).toEqual([]);
  });

  it('fails before planning anything when the origin has both tables', () => {
    const both = sqliteContractToSchema(
      contractOf('userProfile', derivedIndex, 'both', { UserProfile: plainTable() }),
    );
    const result = plan(destination(), both);

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        kind: 'hintRejected',
        meta: expect.objectContaining({ code: 'MIGRATION.HINT_CONTRADICTED' }),
      }),
    ]);
  });
});
