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
import { col, lit, primaryKey } from '@internal/sql-relational-core/contract-free';
import { describe, expect, it } from 'vitest';
import {
  AddColumnCall,
  CreateSchemaCall,
  CreateTableCall,
} from '../../src/core/migrations/op-factory-call';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { renderCallsToTypeScript } from '../../src/core/migrations/render-typescript';

const postgresFacade: ImportRoot = { mode: 'facade', facade: '@prisma/orm-postgres' };
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
  return renderCallsToTypeScript(
    [
      new CreateSchemaCall('app'),
      new CreateTableCall(
        'app',
        'user',
        [col('id', 'text', { notNull: true }), col('kind', 'text', { default: lit('draft') })],
        [primaryKey(['id'])],
      ),
      new AddColumnCall('app', 'user', col('email', 'text')),
    ],
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
  return createPostgresMigrationPlanner(stubLowerer)
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
    expect(packageImports(render(internalImportRoot))).toEqual(['@internal/postgres/migration']);
  });

  it('names the published facade under the facade root', () => {
    expect(packageImports(render(postgresFacade))).toEqual(['@prisma/orm-postgres/migration']);
  });

  it('leaves the relative snapshot imports alone', () => {
    const relative = importedSpecifiers(render(postgresFacade))
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
    for (const root of [internalImportRoot, postgresFacade]) {
      expect(transitiveImports(render(root), root)).toEqual([]);
    }
  });

  it('changes nothing but the import specifiers', () => {
    const withoutImports = (source: string) =>
      source
        .split('\n')
        .filter((line) => !line.includes("from '"))
        .join('\n');

    expect(withoutImports(render(postgresFacade))).toEqual(
      withoutImports(render(internalImportRoot)),
    );
  });

  // The blocker is the *name* the scaffold carries, not the module behind it.
  // `@internal/postgres/migration` is a one-line
  // `export * from '@internal/target-postgres/migration'`. The four-way
  // merge — the target's `Migration` base, the CLI's `MigrationCLI`, the SQL
  // family's DDL builders, the framework's `placeholder` — lives in the
  // target's own `src/exports/migration.ts`, which is platform-owned and
  // resolves under every root (see the next case). Platform fails only
  // because the emitted constant names the facade's alias rather than the
  // module that alias points at.
  //
  // Two ways to close it, both of which have to land with the switch to
  // published names because both change what emission writes by default:
  // (a) record entrypoint aliases in `@internal/publish-surface` — "this
  //     facade subpath is a pure re-export of that target subpath" —
  //     consulted when direct resolution lands outside the root's direct
  //     dependencies; or
  // (b) change the authored constant to the target specifier, which is
  //     simpler but changes default output, so it cannot land before the flip.
  it('refuses the platform root, which has no name for the facade alias', () => {
    expect(() => render(platform)).toThrow(ImportRootError);
    expect(() => render(platform)).toThrow(/does not depend on directly/);
  });

  it('resolves the module behind the facade alias under every root', () => {
    // Evidence for the note above: the underlying target specifier is not the
    // obstacle, so both fixes are real options rather than wishful.
    expect(createImportSpecifierResolver(platform)('@internal/target-postgres/migration')).toBe(
      '@prisma/orm-target-postgres/target/migration',
    );
    expect(
      createImportSpecifierResolver(postgresFacade)('@internal/target-postgres/migration'),
    ).toBe('@prisma/orm-postgres/target/migration');
  });
});

describe('the empty migration `migration new` scaffolds', () => {
  it('names the workspace package under the internal root', () => {
    expect(packageImports(scaffold(internalImportRoot))).toEqual(['@internal/postgres/migration']);
  });

  it('names the published facade under the facade root', () => {
    expect(packageImports(scaffold(postgresFacade))).toEqual(['@prisma/orm-postgres/migration']);
  });

  it('imports nothing the application would not depend on directly', () => {
    for (const root of [internalImportRoot, postgresFacade]) {
      expect(transitiveImports(scaffold(root), root)).toEqual([]);
    }
  });
});
