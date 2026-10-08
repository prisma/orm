import { asNamespaceId, type Contract } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
  type ResolvedMigrationStatement,
  type ResolvedModelRenameStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { type SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import type { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { postgresTypeComponents } from '../postgres-type-lookups';
import {
  contractOf,
  type ProfileSpec,
  reference,
  stubLowerer,
  withModels,
} from './rename-table-fixtures';

const ALL_CLASSES = { allowedOperationClasses: ['additive', 'widening', 'destructive'] as const };

function renameModel(
  from: string,
  to: string,
  fromNs: string = UNBOUND_NAMESPACE_ID,
  toNs: string = fromNs,
): ResolvedModelRenameStatement {
  return {
    kind: 'rename',
    entity: 'model',
    from: { namespaceId: asNamespaceId(fromNs), model: from },
    to: { namespaceId: asNamespaceId(toNs), model: to },
  };
}

const uniqueEmail: ProfileSpec = { uniques: [{ columns: ['email'] }] };

function postTableNamed(postTableName: string, profileTableName: string): StorageTable {
  const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false };
  return new StorageTable({
    columns: { id: int4, profileId: int4 },
    primaryKey: { columns: ['id'], name: `${postTableName}_pk` },
    uniques: [],
    indexes: [],
    foreignKeys: [
      {
        source: reference(postTableName, ['profileId']),
        target: reference(profileTableName, ['id']),
      },
    ],
  });
}

function plan(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  statements: readonly ResolvedMigrationStatement[],
  schema: PostgresDatabaseSchemaNode = postgresContractToSchema(from, postgresTypeComponents),
  policy: MigrationOperationPolicy = ALL_CLASSES,
) {
  return createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema,
    policy,
    fromContract: from,
    origin: planOriginOf(from),
    statements,
    frameworkComponents: postgresTypeComponents,
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

describe('Postgres planner, model statements', () => {
  const from = withModels(contractOf('Profile', uniqueEmail, 'from'), { Profile: 'Profile' });
  const to = withModels(contractOf('User', uniqueEmail, 'to'), { User: 'User' });

  it('plans the table rename and its companions in place of a drop and create', async () => {
    expect(await labelsOf(plan(from, to, [renameModel('Profile', 'User')]))).toEqual([
      'Rename table "Profile" to "User"',
      'Rename unique constraint "Profile_email_key" to "User_email_key" on "User"',
    ]);
  });

  it('reads the statements against fromContract and asserts only the origin it is given', async () => {
    const result = createPostgresMigrationPlanner(stubLowerer).plan({
      contract: to,
      schema: postgresContractToSchema(from, postgresTypeComponents),
      policy: ALL_CLASSES,
      fromContract: from,
      origin: null,
      statements: [renameModel('Profile', 'User')],
      frameworkComponents: postgresTypeComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (result.kind !== 'success') throw new Error('expected a plan');
    expect(result.appliedStatements).toHaveLength(1);
    expect({ origin: result.plan.origin, from: result.plan.describe().from }).toEqual({
      origin: null,
      from: null,
    });
  });

  it('drops and creates the table without a statement', async () => {
    const labels = await labelsOf(plan(from, to, []));
    expect(labels).toContain('Create table "User"');
    expect(labels).toContain('Drop table "Profile"');
  });

  it('reports each statement with the positions of the operations it accounts for', () => {
    const statement = renameModel('Profile', 'User');
    const result = plan(from, to, [statement]);
    if (result.kind !== 'success') throw new Error('expected a plan');
    expect(result.appliedStatements).toEqual([{ statement, operationIndexes: [0, 1] }]);
  });

  it('puts the renames ahead of the rest of the plan', async () => {
    const toWithColumn = withModels(
      contractOf('User', uniqueEmail, 'to', (profile) => ({
        audit: postTableNamed('audit', profile),
      })),
      { User: 'User' },
    );
    const labels = await labelsOf(plan(from, toWithColumn, [renameModel('Profile', 'User')]));
    expect(labels.slice(0, 2)).toEqual([
      'Rename table "Profile" to "User"',
      'Rename unique constraint "Profile_email_key" to "User_email_key" on "User"',
    ]);
    expect(labels.slice(2)).toContain('Create table "audit"');
  });

  it('renames no constraint on a new table that takes the renamed table’s old name', async () => {
    const toWithNewProfile = withModels(
      contractOf('User', uniqueEmail, 'to', (profile) => ({
        Profile: postTableNamed('Profile', profile),
      })),
      { User: 'User', Profile: 'Profile' },
    );
    const labels = await labelsOf(plan(from, toWithNewProfile, [renameModel('Profile', 'User')]));
    expect(
      labels.filter((label) => label.startsWith('Rename') && label.endsWith('on "Profile"')),
    ).toEqual([]);
    expect(labels).toContain('Create table "Profile"');
  });

  it('applies a statement whose table does not change with no operations', async () => {
    const mapped = withModels(contractOf('profile', uniqueEmail, 'to'), { User: 'profile' });
    const fromMapped = withModels(contractOf('profile', uniqueEmail, 'from'), {
      Profile: 'profile',
    });
    const result = plan(fromMapped, mapped, [renameModel('Profile', 'User')]);
    expect(await labelsOf(result)).toEqual([]);
    expect(result.kind === 'success' && result.appliedStatements).toEqual([
      expect.objectContaining({ operationIndexes: [] }),
    ]);
  });

  it('plans two statements in the order given, each with its companions', async () => {
    const fromTwo = withModels(
      contractOf('Profile', uniqueEmail, 'from', (profile) => ({
        post: postTableNamed('post', profile),
      })),
      { Profile: 'Profile', Post: 'post' },
    );
    const toTwo = withModels(
      contractOf('User', uniqueEmail, 'to', (profile) => ({
        Article: postTableNamed('Article', profile),
      })),
      { User: 'User', Article: 'Article' },
    );
    expect(
      await labelsOf(
        plan(fromTwo, toTwo, [renameModel('Profile', 'User'), renameModel('Post', 'Article')]),
      ),
    ).toEqual([
      'Rename table "Profile" to "User"',
      'Rename unique constraint "Profile_email_key" to "User_email_key" on "User"',
      'Rename table "post" to "Article"',
      'Rename primary key "post_pk" to "Article_pk" on "Article"',
      'Rename foreign key "post_profileId_fkey" to "Article_profileId_fkey" on "Article"',
    ]);
  });

  it('pairs foreign keys against the tables earlier statements renamed', async () => {
    const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false };
    const ownerTable = () =>
      new StorageTable({
        columns: { id: int4 },
        primaryKey: { columns: ['id'], name: 'owner_pk' },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      });
    const linkTable = (
      name: string,
      keys: readonly (readonly [fkName: string, referencedTable: string])[],
    ) =>
      new StorageTable({
        columns: { id: int4, refId: int4 },
        primaryKey: { columns: ['id'], name: 'link_pk' },
        uniques: [],
        indexes: [],
        foreignKeys: keys.map(([fkName, referencedTable]) => ({
          source: reference(name, ['refId']),
          target: reference(referencedTable, ['id']),
          name: fkName,
        })),
      });
    const fromThree = withModels(
      contractOf('Profile', uniqueEmail, 'from', () => ({
        Owner: ownerTable(),
        post: linkTable('post', [
          ['post_a', 'Profile'],
          ['post_b', 'Owner'],
        ]),
      })),
      { Profile: 'Profile', Owner: 'Owner', Post: 'post' },
    );
    const toThree = withModels(
      contractOf('User', uniqueEmail, 'to', () => ({
        Member: ownerTable(),
        Article: linkTable('Article', [
          ['article_b', 'Member'],
          ['article_a', 'User'],
        ]),
      })),
      { User: 'User', Member: 'Member', Article: 'Article' },
    );
    const labels = await labelsOf(
      plan(fromThree, toThree, [
        renameModel('Profile', 'User'),
        renameModel('Owner', 'Member'),
        renameModel('Post', 'Article'),
      ]),
    );
    expect(labels).toContain('Rename foreign key "post_a" to "article_a" on "Article"');
    expect(labels).toContain('Rename foreign key "post_b" to "article_b" on "Article"');
  });

  it('plans a case-only rename as a rename instead of refusing it', async () => {
    const fromLower = withModels(contractOf('user', {}, 'from'), { user: 'user' });
    const toUpper = withModels(contractOf('User', {}, 'to'), { User: 'User' });
    expect(await labelsOf(plan(fromLower, toUpper, [renameModel('user', 'User')]))).toEqual([
      'Rename table "user" to "User"',
    ]);
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
    const external = withModels(contractOf('User', { ...uniqueEmail, control: 'external' }, 'to'), {
      User: 'User',
    });
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
    const otherSchema = postgresContractToSchema(
      contractOf('Other', {}, 'other'),
      postgresTypeComponents,
    );
    expect(conflictsOf(plan(from, to, [renameModel('Profile', 'User')], otherSchema))).toEqual([
      expect.objectContaining({
        kind: 'statementRefused',
        summary: expect.stringContaining('has no table "Profile"'),
      }),
    ]);
  });

  it('refuses moving a model to another namespace, naming both coordinates', () => {
    const fromAuth = withModels(
      contractOf('User', {}, 'from', () => ({}), 'auth'),
      { User: 'User' },
      'auth',
    );
    const toBilling = withModels(
      contractOf('User', {}, 'to', () => ({}), 'billing'),
      { User: 'User' },
      'billing',
    );
    const statement = renameModel('User', 'User', 'auth', 'billing');
    expect(conflictsOf(plan(fromAuth, toBilling, [statement]))).toEqual([
      expect.objectContaining({
        kind: 'statementRefused',
        summary:
          'Moving a model to another namespace is not supported in this release: "auth.User" to "billing.User"',
        refusedStatement: statement,
      }),
    ]);
  });
});
