import { describe, expect, it } from 'vitest';
import { DropTableCall } from '../../src/core/migrations/op-factory-call';
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
