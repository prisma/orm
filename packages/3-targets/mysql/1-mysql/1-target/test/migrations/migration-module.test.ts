import { col, fn, lit, primaryKey, unique } from '@internal/sql-relational-core/contract-free';
import { TsExpression } from '@internal/ts-render';
import { describe, expect, it } from 'vitest';
import * as opFactoryCalls from '../../src/core/migrations/op-factory-call';
import {
  AddColumnCall,
  AddForeignKeyCall,
  AddUniqueCall,
  CreateIndexCall,
  CreateTableCall,
  DropColumnCall,
  DropForeignKeyCall,
  DropIndexCall,
  DropTableCall,
  DropUniqueCall,
  RawSqlCall,
  renameTableByHandOp,
} from '../../src/core/migrations/op-factory-call';
import { renderCallsToTypeScript } from '../../src/core/migrations/render-typescript';
import { createMysqlPlanner } from './fixtures';

const MODULE = '@acme/orm-db/migration';
const FROM_HASH = 'a'.repeat(64);
const TO_HASH = 'b'.repeat(64);

function packageImports(source: string): string[] {
  return [...source.matchAll(/from '([^']+)'/g)]
    .map(([, module]) => module ?? '')
    .filter((module) => !module.startsWith('.'));
}

describe('the module a rendered MySQL migration imports from', () => {
  it('is the module the config names, for every package import of a planned migration', () => {
    const source = renderCallsToTypeScript([new DropTableCall('stale')], {
      from: FROM_HASH,
      to: TO_HASH,
      snapshotsImportPath: '../../snapshots',
      migrationModule: MODULE,
    });

    expect(packageImports(source)).toEqual([MODULE]);
  });

  it('is the module the config names when the migration holds one call of every class', () => {
    const calls = [
      new CreateTableCall(
        'User',
        [
          col('id', 'int', { notNull: true, default: fn('autoincrement()') }),
          col('name', 'varchar(191)', { default: lit('anon') }),
        ],
        [primaryKey(['id']), unique(['name'], { name: 'User_name_key' })],
      ),
      new AddColumnCall('User', col('age', 'int')),
      new DropColumnCall('User', 'age'),
      new CreateIndexCall('User', 'User_name_idx', ['name'], false),
      new DropIndexCall('User', 'User_name_idx'),
      new AddUniqueCall('User', 'User_name_key', ['name']),
      new DropUniqueCall('User', 'User_name_key'),
      new AddForeignKeyCall('Post', {
        name: 'Post_authorId_fkey',
        columns: ['authorId'],
        references: { table: 'User', columns: ['id'] },
        onDelete: 'cascade',
        onUpdate: 'restrict',
      }),
      new DropForeignKeyCall('Post', 'Post_authorId_fkey'),
      new DropTableCall('User'),
      new RawSqlCall(renameTableByHandOp('Old', 'New', 'mysql')),
    ];
    const moduleMembers: unknown[] = Object.values(opFactoryCalls);
    const callClasses = moduleMembers.filter(
      (value): value is abstract new () => TsExpression =>
        typeof value === 'function' && value.prototype instanceof TsExpression,
    );
    const covered = new Set<unknown>(calls.map((call) => call.constructor));
    const source = renderCallsToTypeScript(calls, {
      from: FROM_HASH,
      to: TO_HASH,
      snapshotsImportPath: '../../snapshots',
      migrationModule: MODULE,
    });

    expect({
      uncovered: callClasses.filter((cls) => !covered.has(cls)),
      packageImports: packageImports(source),
    }).toEqual({ uncovered: [], packageImports: [MODULE] });
  });

  it('is the module the config names for the empty migration `migration new` writes', () => {
    const source = createMysqlPlanner()
      .emptyMigration(
        {
          packageDir: '/p',
          fromHash: FROM_HASH,
          toHash: TO_HASH,
          snapshotsImportPath: '../../snapshots',
        },
        'app',
      )
      .renderTypeScript(MODULE);

    expect(packageImports(source)).toEqual([MODULE]);
  });
});
