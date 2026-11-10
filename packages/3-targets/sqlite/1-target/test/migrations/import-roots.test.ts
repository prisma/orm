import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import {
  createImportSpecifierResolver,
  type ImportRoot,
  ImportRootError,
  importedSpecifiers,
  internalImportRoot,
  transitiveImports,
} from '@internal/publish-surface/import-roots';
import { describe, expect, it } from 'vitest';
import { DropTableCall } from '../../src/core/migrations/op-factory-call';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { renderCallsToTypeScript } from '../../src/core/migrations/render-typescript';

const sqliteFacade: ImportRoot = { mode: 'facade', facade: '@prisma/orm-sqlite' };
const platform: ImportRoot = { mode: 'platform' };

const FROM_HASH = 'a'.repeat(64);
const TO_HASH = 'b'.repeat(64);

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => {
    throw new Error('lower() called while scaffolding an empty migration');
  },
  renderColumnDefault: async () => '',
  lowerToExecuteRequest: async () => ({ sql: '', params: [] }),
};

function render(root: ImportRoot): string {
  return renderCallsToTypeScript([new DropTableCall('stale')], {
    from: FROM_HASH,
    to: TO_HASH,
    snapshotsImportPath: '../../snapshots',
    resolveImportSpecifier: createImportSpecifierResolver(root),
  });
}

/**
 * The empty plan `migration new` scaffolds from, so the assertions below run
 * through `MigrationPlanWithAuthoringSurface.renderTypeScript` — the seam the
 * CLI actually uses — rather than calling the renderer directly.
 */
function scaffold(root: ImportRoot): string {
  return createSqliteMigrationPlanner(stubLowerer)
    .emptyMigration(
      {
        packageDir: '/tmp/migration-pkg',
        fromHash: FROM_HASH,
        toHash: TO_HASH,
        snapshotsImportPath: '../../snapshots',
      },
      APP_SPACE_ID,
    )
    .renderTypeScript(createImportSpecifierResolver(root));
}

/** Snapshot imports are relative paths, which no import root governs. */
function packageImports(source: string): string[] {
  return importedSpecifiers(source)
    .filter((specifier) => !specifier.startsWith('.'))
    .sort();
}

describe('emitted migration files under each import root', () => {
  it('names the workspace facade under the internal root', () => {
    expect(packageImports(render(internalImportRoot))).toEqual(['@internal/sqlite/migration']);
  });

  it('names the published facade under the facade root', () => {
    expect(packageImports(render(sqliteFacade))).toEqual(['@prisma/orm-sqlite/migration']);
  });

  it('imports nothing the application would not depend on directly', () => {
    for (const root of [internalImportRoot, sqliteFacade]) {
      expect(transitiveImports(render(root), root)).toEqual([]);
    }
  });

  it('changes nothing but the import specifiers', () => {
    const withoutImports = (source: string) =>
      source
        .split('\n')
        .filter((line) => !line.includes("from '"))
        .join('\n');

    expect(withoutImports(render(sqliteFacade))).toEqual(
      withoutImports(render(internalImportRoot)),
    );
  });

  // Same shape as Postgres, and the same cause: `@internal/sqlite/migration`
  // is a one-line `export * from '@internal/target-sqlite/migration'`, and
  // the module behind it is platform-owned and resolves under every root (see
  // the next case). Only the alias the scaffold names has no platform form.
  // The two candidate fixes are recorded on the Postgres equivalent; both
  // have to land with the switch to published names.
  it('refuses the platform root, which has no name for the facade alias', () => {
    expect(() => render(platform)).toThrow(ImportRootError);
  });

  it('resolves the module behind the facade alias under every root', () => {
    expect(createImportSpecifierResolver(platform)('@internal/target-sqlite/migration')).toBe(
      '@prisma/orm-target-sqlite/target/migration',
    );
    expect(createImportSpecifierResolver(sqliteFacade)('@internal/target-sqlite/migration')).toBe(
      '@prisma/orm-sqlite/target/migration',
    );
  });
});

describe('the empty migration `migration new` scaffolds', () => {
  it('names the workspace package under the internal root', () => {
    expect(packageImports(scaffold(internalImportRoot))).toEqual(['@internal/sqlite/migration']);
  });

  it('names the published facade under the facade root', () => {
    expect(packageImports(scaffold(sqliteFacade))).toEqual(['@prisma/orm-sqlite/migration']);
  });

  it('imports nothing the application would not depend on directly', () => {
    for (const root of [internalImportRoot, sqliteFacade]) {
      expect(transitiveImports(scaffold(root), root)).toEqual([]);
    }
  });
});
