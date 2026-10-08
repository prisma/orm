import { asNamespaceId, type Contract } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
  type ResolvedMigrationStatement,
  type ResolvedModelRenameStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { sqliteTestComponents, sqliteTestTypes } from '../sqlite-test-types';
import {
  contractOf,
  HANDLE_INDEX_HASH,
  handleIndex,
  type ProfileSpec,
  plainTable,
  stubLowerer,
  withModels,
} from './rename-table-fixtures';

const ALL_CLASSES = { allowedOperationClasses: ['additive', 'widening', 'destructive'] as const };

function renameModel(from: string, to: string): ResolvedModelRenameStatement {
  return {
    kind: 'rename',
    entity: 'model',
    from: { namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID), model: from },
    to: { namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID), model: to },
  };
}

const derivedIndex: ProfileSpec = { indexes: (tableName) => [handleIndex(tableName)] };

function plan(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  statements: readonly ResolvedMigrationStatement[],
  schema: SqlSchemaIR = sqliteContractToSchema(from, sqliteTestTypes),
  policy: MigrationOperationPolicy = ALL_CLASSES,
) {
  return createSqliteMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema,
    policy,
    fromContract: from,
    origin: planOriginOf(from),
    statements,
    frameworkComponents: sqliteTestComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
}

async function labelsOf(result: ReturnType<typeof plan>): Promise<readonly string[]> {
  if (result.kind !== 'success') {
    throw new Error(`expected a plan, got ${JSON.stringify(result.conflicts)}`);
  }
  const ops = await Promise.all(result.plan.operations);
  return ops.map((op) => op.label);
}

function conflictsOf(result: ReturnType<typeof plan>) {
  if (result.kind !== 'failure') throw new Error('expected the plan to fail');
  return result.conflicts;
}

describe('SQLite planner, model statements', () => {
  const from = withModels(contractOf('Profile', derivedIndex, 'from'), { Profile: 'Profile' });
  const to = withModels(contractOf('User', derivedIndex, 'to'), { User: 'User' });

  it('plans the table rename and its index replacements in place of a drop and create', async () => {
    expect(await labelsOf(plan(from, to, [renameModel('Profile', 'User')]))).toEqual([
      'Rename table Profile to User',
      `Drop index Profile_handle_idx_${HANDLE_INDEX_HASH} on User`,
      `Create index User_handle_idx_${HANDLE_INDEX_HASH} on User`,
    ]);
  });

  it('drops and creates the table without a statement', async () => {
    const labels = await labelsOf(plan(from, to, []));
    expect(labels).toContain('Create table User');
    expect(labels).toContain('Drop table Profile');
  });

  it('reports each statement with the positions of the operations it accounts for', () => {
    const statement = renameModel('Profile', 'User');
    const result = plan(from, to, [statement]);
    if (result.kind !== 'success') throw new Error('expected a plan');
    expect(result.appliedStatements).toEqual([{ statement, operationIndexes: [0, 1, 2] }]);
  });

  it('puts the renames ahead of the rest of the plan', async () => {
    const toWithTable = withModels(
      contractOf('User', derivedIndex, 'to', { audit: plainTable() }),
      { User: 'User' },
    );
    const labels = await labelsOf(plan(from, toWithTable, [renameModel('Profile', 'User')]));
    expect(labels[0]).toBe('Rename table Profile to User');
    expect(labels.slice(3)).toContain('Create table audit');
  });

  it('applies a statement whose table does not change with no operations', async () => {
    const fromMapped = withModels(contractOf('profile', {}, 'from'), { Profile: 'profile' });
    const toMapped = withModels(contractOf('profile', {}, 'to'), { User: 'profile' });
    const result = plan(fromMapped, toMapped, [renameModel('Profile', 'User')]);
    expect(await labelsOf(result)).toEqual([]);
    expect(result.kind === 'success' && result.appliedStatements).toEqual([
      expect.objectContaining({ operationIndexes: [] }),
    ]);
  });

  it('plans two statements in the order given', async () => {
    const fromTwo = withModels(contractOf('Profile', {}, 'from', { audit: plainTable() }), {
      Profile: 'Profile',
      Audit: 'audit',
    });
    const toTwo = withModels(contractOf('User', {}, 'to', { Log: plainTable() }), {
      User: 'User',
      Log: 'Log',
    });
    expect(
      await labelsOf(
        plan(fromTwo, toTwo, [renameModel('Audit', 'Log'), renameModel('Profile', 'User')]),
      ),
    ).toEqual(['Rename table audit to Log', 'Rename table Profile to User']);
  });

  it('refuses a statement under a policy that does not allow its operations', () => {
    const statement = renameModel('Profile', 'User');
    const additiveOnly = { allowedOperationClasses: ['additive'] as const };
    expect(conflictsOf(plan(from, to, [statement], undefined, additiveOnly))).toEqual([
      expect.objectContaining({
        kind: 'statementRefused',
        refusedOperationClass: 'widening',
        refusedStatement: statement,
      }),
    ]);
  });

  it('refuses a rename of a table whose control policy is not managed', () => {
    const external = withModels(
      contractOf('User', { ...derivedIndex, control: 'external' }, 'to'),
      { User: 'User' },
    );
    const statement = renameModel('Profile', 'User');
    expect(conflictsOf(plan(from, external, [statement]))).toEqual([
      expect.objectContaining({
        kind: 'statementRefused',
        summary: expect.stringContaining('control policy is "external"'),
        refusedStatement: statement,
        location: { namespaceId: UNBOUND_NAMESPACE_ID, entityKind: 'table', entityName: 'User' },
      }),
    ]);
  });

  it('refuses a rename whose table the schema being planned from does not have', () => {
    const otherSchema = sqliteContractToSchema(contractOf('Other', {}, 'other'), sqliteTestTypes);
    expect(conflictsOf(plan(from, to, [renameModel('Profile', 'User')], otherSchema))).toEqual([
      expect.objectContaining({
        kind: 'statementRefused',
        summary: expect.stringContaining('has no table "Profile"'),
      }),
    ]);
  });

  it('refuses a rename onto a name another table holds in another case, since SQLite ignores case', () => {
    const withUser = withModels(
      contractOf('Profile', derivedIndex, 'from-with-user', { user: plainTable() }),
      { Profile: 'Profile', Account: 'user' },
    );
    expect(conflictsOf(plan(withUser, to, [renameModel('Profile', 'User')]))).toEqual([
      expect.objectContaining({
        kind: 'statementRefused',
        summary:
          'Cannot rename table "Profile" to "User": the schema being planned from already has a table "User", as "user"',
      }),
    ]);
  });

  it('plans a rename that changes only the case of the table name', async () => {
    const lower = withModels(contractOf('profile', derivedIndex, 'from-lower'), {
      profile: 'profile',
    });
    const upper = withModels(contractOf('Profile', derivedIndex, 'to-upper'), {
      Profile: 'Profile',
    });
    expect(await labelsOf(plan(lower, upper, [renameModel('profile', 'Profile')]))).toContain(
      'Rename table profile to Profile',
    );
  });
});
