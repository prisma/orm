import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY, type SqlMigrationPlanOperation } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { type ForeignKey, type ReferentialAction, SqlStorage } from '@internal/sql-contract/types';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { createPostgresMigrationPlanner } from '@internal/target-postgres/planner';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../../src/core/control-adapter';

function createRefActionContract(
  onDelete?: ReferentialAction,
  onUpdate?: ReferentialAction,
): Contract<SqlStorage> {
  const fk: ForeignKey = {
    source: {
      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
      tableName: 'post',
      columns: ['userId'],
    },
    target: {
      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
      tableName: 'user',
      columns: ['id'],
    },
    ...(onDelete !== undefined && { onDelete }),
    ...(onUpdate !== undefined && { onUpdate }),
  };

  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash('contract'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              post: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                  userId: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [fk],
              },
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

const emptySchema = new PostgresDatabaseSchemaNode({
  namespaces: {
    public: new PostgresNamespaceSchemaNode({
      schemaName: 'public',
      tables: {},
    }),
  },
  pgVersion: '',
  roles: [],
  existingSchemas: [],
});

async function planAndGetFkSql(
  onDelete?: ReferentialAction,
  onUpdate?: ReferentialAction,
): Promise<string> {
  const planner = createPostgresMigrationPlanner(
    new PostgresControlAdapter(createPostgresBuiltinCodecLookup()),
  );
  const contract = createRefActionContract(onDelete, onUpdate);
  const result = planner.plan({
    contract,
    schema: emptySchema,
    policy: INIT_ADDITIVE_POLICY,
    fromContract: null,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });

  expect(result.kind).toBe('success');
  if (result.kind !== 'success') throw new Error('Expected success');

  const ops = (await Promise.all(result.plan.operations)) as SqlMigrationPlanOperation<unknown>[];
  const fkOp = ops.find((op) => op.id.startsWith('foreignKey.'));
  expect(fkOp).toBeDefined();

  return fkOp!.execute[0]!.sql;
}

describe('PostgresMigrationPlanner - referential actions DDL', () => {
  it('emits no ON DELETE/ON UPDATE when both are undefined', async () => {
    const sql = await planAndGetFkSql(undefined, undefined);
    expect(sql).not.toContain('ON DELETE');
    expect(sql).not.toContain('ON UPDATE');
  });

  it('emits ON DELETE CASCADE when onDelete is cascade', async () => {
    const sql = await planAndGetFkSql('cascade', undefined);
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).not.toContain('ON UPDATE');
  });

  it('emits ON DELETE RESTRICT when onDelete is restrict', async () => {
    const sql = await planAndGetFkSql('restrict', undefined);
    expect(sql).toContain('ON DELETE RESTRICT');
  });

  it('emits ON DELETE SET NULL when onDelete is setNull', async () => {
    const sql = await planAndGetFkSql('setNull', undefined);
    expect(sql).toContain('ON DELETE SET NULL');
  });

  it('emits ON DELETE SET DEFAULT when onDelete is setDefault', async () => {
    const sql = await planAndGetFkSql('setDefault', undefined);
    expect(sql).toContain('ON DELETE SET DEFAULT');
  });

  it('emits ON DELETE NO ACTION when onDelete is noAction', async () => {
    const sql = await planAndGetFkSql('noAction', undefined);
    expect(sql).toContain('ON DELETE NO ACTION');
  });

  it('emits ON UPDATE CASCADE when onUpdate is cascade', async () => {
    const sql = await planAndGetFkSql(undefined, 'cascade');
    expect(sql).not.toContain('ON DELETE');
    expect(sql).toContain('ON UPDATE CASCADE');
  });

  it('emits both clauses when both onDelete and onUpdate are specified', async () => {
    const sql = await planAndGetFkSql('cascade', 'cascade');
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).toContain('ON UPDATE CASCADE');
  });

  it.each([
    { action: 'noAction' as const, expected: 'NO ACTION' },
    { action: 'restrict' as const, expected: 'RESTRICT' },
    { action: 'cascade' as const, expected: 'CASCADE' },
    { action: 'setNull' as const, expected: 'SET NULL' },
    { action: 'setDefault' as const, expected: 'SET DEFAULT' },
  ])('maps $action to $expected in ON DELETE clause', async ({ action, expected }) => {
    const sql = await planAndGetFkSql(action, undefined);
    expect(sql).toContain(`ON DELETE ${expected}`);
  });
});
