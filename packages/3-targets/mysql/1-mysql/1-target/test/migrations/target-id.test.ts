import type {
  ControlStack,
  ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { col } from '@internal/sql-relational-core/contract-free';
import { describe, expect, it } from 'vitest';
import { mysqlTargetDescriptorMeta } from '../../src/core/descriptor-meta';
import { createMysqlControlTargetDescriptor } from '../../src/core/migrations/control-target';
import { MysqlMigrationBase } from '../../src/core/migrations/mysql-migration';
import { DropTableCall, renameTableByHandOp } from '../../src/core/migrations/op-factory-call';
import {
  createMysqlMigrationPlanner,
  type MysqlMigrationPlanner,
} from '../../src/core/migrations/planner';
import { renderOps } from '../../src/core/migrations/render-ops';
import { contractOf, frameworkComponents, int, stubLowerer } from './fixtures';

const MARIADB = { targetId: 'mariadb', migrationModule: '@internal/mariadb/migration' } as const;

const mariadbMeta = {
  ...mysqlTargetDescriptorMeta,
  targetId: 'mariadb',
  id: 'mariadb',
  displayName: 'MariaDB',
  sessionSettings: { time_zone: '+00:00', tx_isolation: 'READ-COMMITTED' },
} as const;

class MariadbExample extends MysqlMigrationBase<'mariadb'> {
  readonly targetId = 'mariadb' as const;

  override get operations() {
    return [
      this.createTable({ table: 'T', columns: [col('id', 'int', { notNull: true })] }),
      this.dropTable({ table: 'T' }),
      this.addColumn({ table: 'T', column: col('a', 'int') }),
      this.dropColumn({ table: 'T', column: 'a' }),
      this.createIndex({ table: 'T', index: 'T_a_idx', columns: ['a'] }),
      this.dropIndex({ table: 'T', index: 'T_a_idx' }),
      this.addUnique({ table: 'T', name: 'T_a_key', columns: ['a'] }),
      this.dropUnique({ table: 'T', name: 'T_a_key' }),
      this.addForeignKey({
        table: 'T',
        name: 'T_a_fkey',
        columns: ['a'],
        references: { table: 'U', columns: ['id'] },
      }),
      this.dropForeignKey({ table: 'T', name: 'T_a_fkey' }),
    ];
  }
}

function planUserTable(planner: MysqlMigrationPlanner<string>) {
  const result = planner.plan({
    contract: contractOf('c'.repeat(64), {
      User: { columns: { id: int }, primaryKey: { columns: ['id'] } },
    }),
    schema: mysqlControlTarget().migrations.contractToSchema(null, frameworkComponents),
    policy: { allowedOperationClasses: ['additive'] },
    fromContract: null,
    origin: null,
    statements: [],
    frameworkComponents,
    spaceId: 'app',
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return result.plan;
}

function mysqlControlTarget() {
  return createMysqlControlTargetDescriptor({
    descriptorMeta: mysqlTargetDescriptorMeta,
    migrationModule: '@internal/mysql/migration',
  });
}

describe('a target that extends MySQL', () => {
  it('writes every operation of its migration class with its own target id', async () => {
    const stack = { adapter: { create: () => stubLowerer } } as unknown as ControlStack<
      'sql',
      'mariadb'
    >;
    const migration = new MariadbExample(stack);
    const operations = await Promise.all(migration.operations);
    expect({
      targetId: migration.targetId,
      operationTargets: [...new Set(operations.map(({ target }) => target.id))],
    }).toEqual({ targetId: 'mariadb', operationTargets: ['mariadb'] });
  });

  it('renders operations for its own target id and refuses one built for MySQL', async () => {
    const mysqlCall = {
      factoryName: 'mysqlOnly',
      operationClass: 'destructive',
      label: 'MySQL only',
      toOp: () => new DropTableCall('x').toOp(undefined, 'mysql'),
      renderTypeScript: () => '',
      importRequirements: () => [],
    };
    const [op] = renderOps([new DropTableCall('x')], stubLowerer, 'mariadb');
    expect({
      target: (await op)?.target.id,
      rename: renameTableByHandOp('Old', 'New', 'mariadb').target.id,
    }).toEqual({ target: 'mariadb', rename: 'mariadb' });
    expect(() => renderOps([mysqlCall as never], stubLowerer, 'mariadb')).toThrow(
      /expected a mariadb operation/,
    );
  });

  it('plans operations with its target id and writes migration.ts against its own migration module', async () => {
    const plan = planUserTable(createMysqlMigrationPlanner(stubLowerer, MARIADB));
    const operations = await Promise.all(plan.operations);
    const source = plan.renderTypeScript((specifier) => specifier);
    const modules = [...source.matchAll(/from '([^']+)'/g)]
      .map(([, module]) => module)
      .filter((module) => module?.startsWith('@internal/'));
    expect({
      targetId: plan.targetId,
      operationTargets: operations.map(({ target }) => target.id),
      modules: [...new Set(modules)],
    }).toEqual({
      targetId: 'mariadb',
      operationTargets: ['mariadb'],
      modules: ['@internal/mariadb/migration'],
    });
  });

  it('refuses a statement without naming MySQL', () => {
    const rename = { kind: 'rename' } as unknown as ResolvedMigrationStatement;
    const result = createMysqlMigrationPlanner(stubLowerer, MARIADB).plan({
      contract: contractOf('c'.repeat(64), {}),
      schema: mysqlControlTarget().migrations.contractToSchema(null, frameworkComponents),
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      origin: null,
      statements: [rename],
      frameworkComponents,
      spaceId: 'app',
      snapshotsImportPath: '../../snapshots',
    });
    expect(result).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'statementRefused',
          summary: 'A rename statement is not yet supported by the migration planner',
          why: 'The migration planner plans no rename, conversion or backfill yet. Plan the change without the statement, or write it by hand in a migration of its own with `migration new`.',
          refusedStatement: rename,
        },
      ],
    });
  });

  it('refuses a name longer than 64 characters without naming MySQL', () => {
    const long = 'T'.repeat(65);
    const result = createMysqlMigrationPlanner(stubLowerer, MARIADB).plan({
      contract: contractOf('c'.repeat(64), {
        [long]: { columns: { id: int }, primaryKey: { columns: ['id'] } },
      }),
      schema: mysqlControlTarget().migrations.contractToSchema(null, frameworkComponents),
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: 'app',
      snapshotsImportPath: '../../snapshots',
    });
    expect(result.kind === 'failure' ? result.conflicts : []).toEqual([
      expect.objectContaining({
        summary: `The name ${long} is longer than the 64 characters the database allows (${long})`,
        why: 'The database refuses a table, column, index or constraint name longer than 64 characters. Give it a shorter name in the contract.',
      }),
    ]);
  });

  it('builds a control target from its own descriptor meta, with its session settings and planner', () => {
    const target = createMysqlControlTargetDescriptor({
      descriptorMeta: mariadbMeta,
      migrationModule: MARIADB.migrationModule,
    });
    const planner = target.migrations.createPlanner(
      stubLowerer as never,
    ) as MysqlMigrationPlanner<'mariadb'>;
    expect({
      instance: target.create(),
      targetId: target.targetId,
      sessionSettings: target.sessionSettings,
      planTargetId: planUserTable(planner).targetId,
    }).toEqual({
      instance: { familyId: 'sql', targetId: 'mariadb' },
      targetId: 'mariadb',
      sessionSettings: { time_zone: '+00:00', tx_isolation: 'READ-COMMITTED' },
      planTargetId: 'mariadb',
    });
  });
});
