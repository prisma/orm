import {
  createImportSpecifierResolver,
  type ImportRoot,
  importedSpecifiers,
  internalImportRoot,
  transitiveImports,
} from '@internal/publish-surface/import-roots';
import { describe, expect, it } from 'vitest';
import { MongoMigrationPlanner } from '../src/core/migrations/mongo-planner';
import { CreateIndexCall } from '../src/core/migrations/op-factory-call';
import { renderCallsToTypeScript } from '../src/core/migrations/render-typescript';

const mongoFacade: ImportRoot = { mode: 'facade', facade: '@prisma/orm-mongo' };
const platform: ImportRoot = { mode: 'platform' };

const FROM_HASH = 'a'.repeat(64);
const TO_HASH = 'b'.repeat(64);

function render(root: ImportRoot): string {
  return renderCallsToTypeScript(
    [new CreateIndexCall('users', [{ field: 'email', direction: 1 }], { unique: true })],
    {
      from: FROM_HASH,
      to: TO_HASH,
      snapshotsImportPath: '../../snapshots',
      resolveImportSpecifier: createImportSpecifierResolver(root),
    },
  );
}

/**
 * The empty plan `migration new` scaffolds from, so the assertions below run
 * through `MigrationPlanWithAuthoringSurface.renderTypeScript` — the seam the
 * CLI actually uses — rather than calling the renderer directly.
 */
function scaffold(root: ImportRoot): string {
  return new MongoMigrationPlanner()
    .emptyMigration({
      packageDir: '/tmp/migration-pkg',
      fromHash: FROM_HASH,
      toHash: TO_HASH,
      snapshotsImportPath: '../../snapshots',
    })
    .renderTypeScript(createImportSpecifierResolver(root));
}

/** Snapshot imports are relative paths, which no import root governs. */
function packageImports(source: string): string[] {
  return importedSpecifiers(source)
    .filter((specifier) => !specifier.startsWith('.'))
    .sort();
}

describe('emitted migration files under each import root', () => {
  // One specifier, the way Postgres and SQLite scaffolds already read. The
  // `Migration` base and `MigrationCLI` reach the scaffold through the
  // target's own `migration` entry, so every name the scaffold carries
  // belongs to the same package and every root has something to map it to.
  it('names one workspace package under the internal root', () => {
    expect(packageImports(render(internalImportRoot))).toEqual([
      '@internal/target-mongo/migration',
    ]);
  });

  it('names the published facade under the facade root', () => {
    expect(packageImports(render(mongoFacade))).toEqual(['@prisma/orm-mongo/target/migration']);
  });

  it('names the target package under the platform root', () => {
    expect(packageImports(render(platform))).toEqual(['@prisma/orm-target-mongo/target/migration']);
  });

  it('leaves the relative snapshot imports alone', () => {
    const relative = importedSpecifiers(render(mongoFacade))
      .filter((specifier) => specifier.startsWith('.'))
      .sort();

    expect(relative).toEqual([
      `../../snapshots/${FROM_HASH}/contract`,
      `../../snapshots/${FROM_HASH}/contract.json`,
      `../../snapshots/${TO_HASH}/contract`,
      `../../snapshots/${TO_HASH}/contract.json`,
    ]);
  });

  it('imports nothing the application would not depend on directly', () => {
    for (const root of [internalImportRoot, mongoFacade, platform]) {
      expect(transitiveImports(render(root), root)).toEqual([]);
    }
  });

  it('changes nothing but the import specifiers', () => {
    const withoutImports = (source: string) =>
      source
        .split('\n')
        .filter((line) => !line.includes("from '"))
        .join('\n');

    for (const root of [mongoFacade, platform]) {
      expect(withoutImports(render(root))).toEqual(withoutImports(render(internalImportRoot)));
    }
  });
});

describe('the empty migration `migration new` scaffolds', () => {
  it('names the workspace package under the internal root', () => {
    expect(packageImports(scaffold(internalImportRoot))).toEqual([
      '@internal/target-mongo/migration',
    ]);
  });

  it('names the published facade under the facade root', () => {
    expect(packageImports(scaffold(mongoFacade))).toEqual(['@prisma/orm-mongo/target/migration']);
  });

  it('imports nothing the application would not depend on directly', () => {
    for (const root of [internalImportRoot, mongoFacade, platform]) {
      expect(transitiveImports(scaffold(root), root)).toEqual([]);
    }
  });
});
