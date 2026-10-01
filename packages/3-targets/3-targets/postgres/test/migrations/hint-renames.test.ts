import type { Contract } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID, type ControlStack } from '@internal/framework-components/control';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { computeCheckContentHash, computeIndexContentHash } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { RenameTableCall } from '../../src/core/migrations/op-factory-call';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { PostgresMigration } from '../../src/core/migrations/postgres-migration';
import { renderCallsToTypeScript } from '../../src/core/migrations/render-typescript';
import { PostgresContractSerializer } from '../../src/core/postgres-contract-serializer';
import {
  contractOf,
  NICKNAME_CHECK,
  type ProfileSpec,
  reference,
  stubLowerer,
} from './rename-table-fixtures';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;
type ContractJson = { readonly storage: { readonly storageHash: string } };

const HANDLE_HASH = computeIndexContentHash({ columns: ['handle'], unique: false });
const NICKNAME_HASH = computeCheckContentHash(NICKNAME_CHECK);
const EVERY_CLASS = { allowedOperationClasses: ['additive', 'widening', 'destructive'] } as const;

function profileSpec(tableName: string, named: boolean, extra: Partial<ProfileSpec> = {}) {
  const name = (derived: string) => (named ? { name: derived } : {});
  return {
    primaryKey: { columns: ['id'], ...name(`${tableName}_pkey`) },
    uniques: [{ columns: ['email'], ...name(`${tableName}_email_key`) }],
    foreignKeys: (table: string) => [
      {
        source: reference(table, ['accountId']),
        target: reference('account', ['id']),
        ...name(`${tableName}_accountId_fkey`),
      },
    ],
    indexes: (table: string) => [
      {
        columns: ['handle'],
        naming: { kind: 'wire' as const, prefix: `${table}_handle_idx`, hash: HANDLE_HASH },
        where: undefined,
        unique: false,
        type: undefined,
        options: undefined,
      },
    ],
    checks: (table: string) => [
      {
        naming: { kind: 'wire' as const, prefix: `${table}_nickname_check`, hash: NICKNAME_HASH },
        expression: NICKNAME_CHECK,
      },
    ],
    rlsPolicy: 'own_rows',
    ...extra,
  } satisfies ProfileSpec;
}

const DESTINATION_HASH = 'b'.repeat(64);

function destination(extra: Partial<ProfileSpec> = {}, was = 'userProfile'): Contract<SqlStorage> {
  return {
    ...contractOf('UserProfile', profileSpec('UserProfile', false, extra), DESTINATION_HASH),
    hints: {
      namespaces: { [UNBOUND_NAMESPACE_ID]: { tables: { UserProfile: { was } } } },
    },
  };
}

const startContract = contractOf('userProfile', profileSpec('userProfile', false), 'from');

/** The origin as introspection reports it: every constraint carries its name. */
const introspectedOrigin = postgresContractToSchema(
  contractOf('userProfile', profileSpec('userProfile', true), 'from'),
  [],
);

function plan(contract: Contract<SqlStorage>, schema = introspectedOrigin) {
  return createPostgresMigrationPlanner(stubLowerer).plan({
    contract,
    schema,
    policy: EVERY_CLASS,
    fromContract: null,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
}

function planned(contract: Contract<SqlStorage>, schema = introspectedOrigin) {
  const result = plan(contract, schema);
  if (result.kind !== 'success') {
    throw new Error(`expected a plan, got ${JSON.stringify(result.conflicts)}`);
  }
  return result;
}

const stack = {
  adapter: { create: () => stubLowerer as unknown as SqlControlAdapter<'postgres'> },
  target: { kind: 'target', familyId: 'sql', targetId: 'postgres' },
  extensions: [],
} as unknown as ControlStack<'sql', 'postgres'>;

function jsonOf(contract: Contract<SqlStorage>): ContractJson {
  return new PostgresContractSerializer().serializeContract(contract) as unknown as ContractJson;
}

async function handWrittenOps(): Promise<readonly Op[]> {
  const startJson = jsonOf(startContract);
  const endJson = jsonOf(destination());
  class HandWritten extends PostgresMigration {
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
      'Rename table "userProfile" to "UserProfile"',
      'Rename primary key "userProfile_pkey" to "UserProfile_pkey" on "UserProfile"',
      'Rename unique constraint "userProfile_email_key" to "UserProfile_email_key" on "UserProfile"',
      'Rename foreign key "userProfile_accountId_fkey" to "UserProfile_accountId_fkey" on "UserProfile"',
      `Rename index "userProfile_handle_idx_${HANDLE_HASH}" to "UserProfile_handle_idx_${HANDLE_HASH}" on "UserProfile"`,
      `Rename check constraint "userProfile_nickname_check_${NICKNAME_HASH}" to "UserProfile_nickname_check_${NICKNAME_HASH}" on "UserProfile"`,
    ]);
    expect(ops).toEqual(expected);
  });

  it('renders the migration as the hand-written one, with only the facade call', () => {
    const result = planned(destination());
    const rendered = result.plan.renderTypeScript(keepInternalSpecifiers);

    expect(rendered).toBe(
      renderCallsToTypeScript(
        [new RenameTableCall(UNBOUND_NAMESPACE_ID, 'userProfile', 'UserProfile', [])],
        {
          from: null,
          to: DESTINATION_HASH,
          snapshotsImportPath: '../../snapshots',
          resolveImportSpecifier: keepInternalSpecifiers,
        },
      ),
    );
    expect(rendered).toContain('...this.renameTable({ table: "userProfile", to: "UserProfile" })');
  });

  it('reports the hint it consumed', () => {
    expect(planned(destination()).plan.consumedHints).toEqual([
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
  });

  it('never reaches the table-name case guard for a hinted case-only rename', () => {
    expect(plan(destination()).kind).toBe('success');
  });

  it('ignores the hint with a warning when the table is not managed, and drops the old table', async () => {
    const origin = postgresContractToSchema(
      contractOf('profile', profileSpec('profile', true), 'from'),
      [],
    );
    const result = planned(destination({ control: 'tolerated' }, 'profile'), origin);
    const ids = (await Promise.all(result.plan.operations)).map((op) => op.id);

    expect(ids).not.toContain('renameTable.profile');
    expect(ids).toContain('dropTable.profile');
    expect(result.plan.consumedHints).toEqual([]);
    expect(result.warnings).toContainEqual({
      kind: 'controlPolicySuppressedCall',
      summary:
        "control policy suppressed: table \"__unbound__.UserProfile\" — namespace '__unbound__' has effective control 'tolerated' but declared 'tolerated'",
      location: {
        namespaceId: UNBOUND_NAMESPACE_ID,
        entityKind: 'table',
        entityName: 'UserProfile',
      },
      meta: {
        controlPolicy: 'tolerated',
        factoryName: 'renameTable',
        declaredControlPolicy: 'tolerated',
      },
    });
  });

  it('plans nothing for a spent hint', async () => {
    const spent = postgresContractToSchema(destination(), []);
    const result = planned(destination(), spent);

    expect(await Promise.all(result.plan.operations)).toEqual([]);
    expect(result.plan.consumedHints).toEqual([]);
  });

  it('plans the new table and consumes nothing when the old table is absent', async () => {
    const empty = postgresContractToSchema(
      contractOf('account_only', {}, 'empty', () => ({})),
      [],
    );
    const result = planned(destination(), empty);
    const ids = (await Promise.all(result.plan.operations)).map((op) => op.id);

    expect(ids).not.toContain('renameTable.userProfile');
    expect(ids).toContain('table.UserProfile');
    expect(result.plan.consumedHints).toEqual([]);
  });

  it('fails before planning anything when the origin has both tables', () => {
    const both = postgresContractToSchema(
      contractOf('userProfile', profileSpec('userProfile', true), 'both', () => ({
        UserProfile: contractOf('UserProfile', {}, 'x').storage.namespaces[UNBOUND_NAMESPACE_ID]!
          .entries.table!['UserProfile']!,
      })),
      [],
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
