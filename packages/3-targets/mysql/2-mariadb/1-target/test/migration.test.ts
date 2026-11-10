import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { ControlStack } from '@internal/framework-components/control';
import { col } from '@internal/sql-relational-core/contract-free';
import { describe, expect, it } from 'vitest';
import mariadbControlTarget from '../src/core/migrations/control-target';
import { MariadbMigration } from '../src/core/migrations/mariadb-migration';

const lowerer: ExecuteRequestLowerer = {
  lower() {
    throw new Error('not used');
  },
  async lowerToExecuteRequest(node) {
    return { sql: node.kind, params: [] };
  },
  async renderColumnDefault() {
    return '';
  },
};

class Example extends MariadbMigration {
  override get operations() {
    return [
      this.createTable({ table: 'T', columns: [col('id', 'int', { notNull: true })] }),
      this.dropTable({ table: 'T' }),
    ];
  }
}

describe('a MariaDB migration', () => {
  it('writes its operations for the MariaDB target', async () => {
    const stack = { adapter: { create: () => lowerer } } as unknown as ControlStack<
      'sql',
      'mariadb'
    >;
    const migration = new Example(stack);
    const operations = await Promise.all(migration.operations);
    expect({
      targetId: migration.targetId,
      operationTargets: operations.map(({ target }) => target.id),
    }).toEqual({ targetId: 'mariadb', operationTargets: ['mariadb', 'mariadb'] });
  });

  it('is scaffolded by the planner against the MariaDB migration module', () => {
    const planner = mariadbControlTarget.migrations.createPlanner(lowerer as never);
    const empty = planner.emptyMigration(
      { packageDir: '/p', fromHash: null, toHash: 'b'.repeat(64), snapshotsImportPath: '../s' },
      'app',
    );
    const source = empty.renderTypeScript((specifier) => specifier);
    const modules = [...source.matchAll(/from '(@internal\/[^']+)'/g)].map(([, module]) => module);
    expect({ targetId: empty.targetId, modules: [...new Set(modules)] }).toEqual({
      targetId: 'mariadb',
      modules: ['@internal/mariadb/migration'],
    });
  });
});
