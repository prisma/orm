import { describe, expect, it } from 'vitest';
import {
  buildOwnerIndex,
  createImportSpecifierResolver,
  createScaffoldSpecifierResolver,
  directDependencyShells,
  type ImportRoot,
  ImportRootError,
  importedSpecifiers,
  importRootForDependencies,
  internalImportRoot,
  platformEntrypointOf,
  resolveImportSpecifier,
  type ScaffoldImportRoot,
  transitiveImports,
} from '../src/import-roots';
import type { ShellDefinition, ShellName } from '../src/shells';

const postgresFacade: ImportRoot = { mode: 'facade', facade: '@prisma/orm-postgres' };
const mongoFacade: ImportRoot = { mode: 'facade', facade: '@prisma/orm-mongo' };
const platform: ImportRoot = { mode: 'platform' };

describe('resolveImportSpecifier', () => {
  describe('internal root', () => {
    it('returns every specifier unchanged', () => {
      for (const specifier of [
        '@internal/sql-contract/types',
        '@internal/contract/types',
        '@internal/postgres/migration',
        '@internal/family-mongo/migration',
      ]) {
        expect(resolveImportSpecifier(specifier, internalImportRoot)).toBe(specifier);
      }
    });
  });

  describe('facade root', () => {
    it('resolves the contract surfaces the facade republishes', () => {
      expect(resolveImportSpecifier('@internal/sql-contract/types', postgresFacade)).toBe(
        '@prisma/orm-postgres/family-contract/types',
      );
      expect(resolveImportSpecifier('@internal/contract/types', postgresFacade)).toBe(
        '@prisma/orm-postgres/contract/types',
      );
      expect(
        resolveImportSpecifier('@internal/framework-components/emission', postgresFacade),
      ).toBe('@prisma/orm-postgres/components/emission');
      expect(resolveImportSpecifier('@internal/target-postgres/codec-types', postgresFacade)).toBe(
        '@prisma/orm-postgres/target/codec-types',
      );
      expect(
        resolveImportSpecifier('@internal/target-postgres/operation-types', postgresFacade),
      ).toBe('@prisma/orm-postgres/target/operation-types');
    });

    it('resolves the facade package itself to the facade shell', () => {
      expect(resolveImportSpecifier('@internal/postgres', postgresFacade)).toBe(
        '@prisma/orm-postgres',
      );
      expect(resolveImportSpecifier('@internal/postgres/migration', postgresFacade)).toBe(
        '@prisma/orm-postgres/migration',
      );
      expect(resolveImportSpecifier('@internal/mongo/runtime', mongoFacade)).toBe(
        '@prisma/orm-mongo/runtime',
      );
    });

    it('resolves an extension pack to its own package, which the application also installs', () => {
      expect(
        resolveImportSpecifier('@internal/extension-pgvector/codec-types', postgresFacade),
      ).toBe('@prisma/orm-extension-pgvector/codec-types');
    });

    it('refuses a surface the facade does not republish', () => {
      expect(() => resolveImportSpecifier('@internal/cli/migration-cli', postgresFacade)).toThrow(
        ImportRootError,
      );
      expect(() => resolveImportSpecifier('@internal/cli/migration-cli', postgresFacade)).toThrow(
        /has no name under @prisma\/orm-postgres/,
      );
    });

    it('does not tell the reader to install the platform package instead', () => {
      // Under a facade the answer is never "add @prisma/orm-family-sql to your
      // dependencies" — that is the shape ADR 242 exists to prevent — so the
      // message says the facade has no name for the module.
      const message = (() => {
        try {
          resolveImportSpecifier('@internal/family-sql', postgresFacade);
          return '';
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      })();

      expect(message).toMatch(/does not republish @prisma\/orm-family-sql\/family/);
      expect(message).not.toMatch(/depend on directly/);
    });

    it('refuses another database facade', () => {
      expect(() => resolveImportSpecifier('@internal/sqlite/migration', postgresFacade)).toThrow(
        ImportRootError,
      );
    });

    it('forwards a subpath-only re-export but not its bare package name', () => {
      // The facade forwards the target under `target/…` for subpaths only —
      // it publishes its own `./target` pack under that name — so the bare
      // package has no facade name and falls through to the target shell,
      // which a facade-only application does not install.
      expect(resolveImportSpecifier('@internal/target-postgres/migration', postgresFacade)).toBe(
        '@prisma/orm-postgres/target/migration',
      );
      expect(() => resolveImportSpecifier('@internal/target-postgres', postgresFacade)).toThrow(
        /has no name under @prisma\/orm-postgres/,
      );
    });

    it('forwards only the subpaths a bounded re-export lists', () => {
      // `migration-tools` is forwarded by subpath: an application reads and
      // writes the on-disk migration format, but the graph, the pathfinder and
      // the ledger are the CLI's own working material and stay unpublished.
      expect(resolveImportSpecifier('@internal/migration-tools/io', postgresFacade)).toBe(
        '@prisma/orm-postgres/migration-tools/io',
      );
      expect(resolveImportSpecifier('@internal/migration-tools/spaces', postgresFacade)).toBe(
        '@prisma/orm-postgres/migration-tools/spaces',
      );
      // A subpath outside the list has no facade name, so it falls through to
      // the platform shell a facade-only application does not install.
      expect(() =>
        resolveImportSpecifier('@internal/migration-tools/graph', postgresFacade),
      ).toThrow(/has no name under @prisma\/orm-postgres/);
      // Nor does the bare package name, which the list cannot contain.
      expect(() => resolveImportSpecifier('@internal/migration-tools', postgresFacade)).toThrow(
        /has no name under @prisma\/orm-postgres/,
      );
    });

    it('rejects a non-facade shell as the facade', () => {
      expect(() =>
        resolveImportSpecifier('@internal/sql-contract/types', {
          mode: 'facade',
          facade: '@prisma/orm-framework',
        }),
      ).toThrow(/is a platform shell, not a facade/);
    });
  });

  describe('platform root', () => {
    it('resolves each package to its own platform shell', () => {
      expect(resolveImportSpecifier('@internal/sql-contract/types', platform)).toBe(
        '@prisma/orm-family-sql/contract/types',
      );
      expect(resolveImportSpecifier('@internal/contract/types', platform)).toBe(
        '@prisma/orm-framework/contract/types',
      );
      expect(resolveImportSpecifier('@internal/mongo-contract', platform)).toBe(
        '@prisma/orm-family-mongo/contract',
      );
      expect(resolveImportSpecifier('@internal/target-postgres/codec-types', platform)).toBe(
        '@prisma/orm-target-postgres/target/codec-types',
      );
      expect(resolveImportSpecifier('@internal/cli/migration-cli', platform)).toBe(
        '@prisma/orm-toolchain/cli/migration-cli',
      );
      expect(resolveImportSpecifier('@internal/family-mongo/migration', platform)).toBe(
        '@prisma/orm-family-mongo/family/migration',
      );
    });

    it('refuses a per-database facade, which a decomposed install does not have', () => {
      expect(() => resolveImportSpecifier('@internal/postgres/migration', platform)).toThrow(
        /@prisma\/orm-postgres\/migration, which an application on the platform import root does not depend on directly/,
      );
    });
  });

  it('leaves specifiers outside the internal scope alone', () => {
    for (const root of [postgresFacade, platform]) {
      expect(resolveImportSpecifier('./snapshots/abc/contract.json', root)).toBe(
        './snapshots/abc/contract.json',
      );
      expect(resolveImportSpecifier('node:crypto', root)).toBe('node:crypto');
      expect(resolveImportSpecifier('arktype', root)).toBe('arktype');
    }
  });

  it('refuses a specifier no shell maps', () => {
    expect(() => resolveImportSpecifier('@internal/not-a-package', platform)).toThrow(
      /is not mapped to any published shell/,
    );
  });
});

describe('directDependencyShells', () => {
  it('is empty for the internal root, which names no published package', () => {
    expect(directDependencyShells(internalImportRoot).size).toBe(0);
  });

  it('is the chosen facade plus the extension packs', () => {
    expect([...directDependencyShells(postgresFacade)].sort()).toEqual([
      '@prisma/orm-extension-arktype-json',
      '@prisma/orm-extension-middleware-cache',
      '@prisma/orm-extension-paradedb',
      '@prisma/orm-extension-pgvector',
      '@prisma/orm-extension-postgis',
      '@prisma/orm-extension-supabase',
      '@prisma/orm-postgres',
    ]);
  });

  it('is every platform shell plus the extension packs, and no facade', () => {
    const shells = directDependencyShells(platform);

    expect(shells.has('@prisma/orm-family-sql')).toBe(true);
    expect(shells.has('@prisma/orm-toolchain')).toBe(true);
    expect(shells.has('@prisma/orm-extension-pgvector')).toBe(true);
    expect(shells.has('@prisma/orm-postgres')).toBe(false);
  });
});

describe('importRootForDependencies', () => {
  it('reads the facade an application installed', () => {
    expect(importRootForDependencies(['@prisma/orm-postgres', 'pg', 'react'])).toEqual(
      postgresFacade,
    );
    expect(importRootForDependencies(['@prisma/orm-mongo'])).toEqual(mongoFacade);
  });

  it('ignores extension packs, which every root allows', () => {
    expect(
      importRootForDependencies(['@prisma/orm-postgres', '@prisma/orm-extension-pgvector']),
    ).toEqual(postgresFacade);
  });

  it('reads a decomposed install from the platform shells it names', () => {
    expect(
      importRootForDependencies(['@prisma/orm-framework', '@prisma/orm-target-postgres']),
    ).toEqual(platform);
  });

  it('prefers the facade when a project also names a platform shell', () => {
    // A facade's own dependencies are installable alongside it; the facade is
    // still the name the application should be emitted against.
    expect(importRootForDependencies(['@prisma/orm-postgres', '@prisma/orm-toolchain'])).toEqual(
      postgresFacade,
    );
  });

  it('falls back to the internal root when no published package is named', () => {
    expect(importRootForDependencies(['@internal/postgres', 'pg'])).toEqual(internalImportRoot);
    expect(importRootForDependencies([])).toEqual(internalImportRoot);
  });

  it('refuses two facades, which no single generated file can be emitted for', () => {
    expect(() => importRootForDependencies(['@prisma/orm-postgres', '@prisma/orm-sqlite'])).toThrow(
      ImportRootError,
    );
  });
});

describe('platformEntrypointOf', () => {
  it('reports the owning shell alongside the entrypoint', () => {
    expect(platformEntrypointOf('@internal/sql-contract/types')).toEqual({
      shell: '@prisma/orm-family-sql',
      id: '@prisma/orm-family-sql/contract/types',
    });
  });

  it('drops the entry namespace for a package that occupies the shell itself', () => {
    expect(platformEntrypointOf('@internal/postgres/migration')).toEqual({
      shell: '@prisma/orm-postgres',
      id: '@prisma/orm-postgres/migration',
    });
  });
});

describe('createImportSpecifierResolver', () => {
  it('is the identity for the internal root', () => {
    const resolve = createImportSpecifierResolver(internalImportRoot);

    expect(resolve('@internal/sql-contract/types')).toBe('@internal/sql-contract/types');
  });

  it('applies the root to each specifier it is handed', () => {
    const resolve = createImportSpecifierResolver(platform);

    expect(resolve('@internal/sql-contract/types')).toBe('@prisma/orm-family-sql/contract/types');
  });
});

describe('createScaffoldSpecifierResolver', () => {
  const postgresScaffold: ScaffoldImportRoot = { mode: 'facade', facade: '@prisma/orm-postgres' };

  it('resolves the roots a scaffold can express', () => {
    expect(createScaffoldSpecifierResolver(internalImportRoot)('@internal/postgres')).toBe(
      '@internal/postgres',
    );
    expect(createScaffoldSpecifierResolver(postgresScaffold)('@internal/postgres/runtime')).toBe(
      '@prisma/orm-postgres/runtime',
    );
  });

  // A decomposed install has no facade wiring for a scaffold to name, so
  // `platform` is rejected where the resolver is built rather than when a
  // template happens to hit a name it cannot resolve.
  it('does not accept the platform root', () => {
    // @ts-expect-error `platform` is not a `ScaffoldImportRoot`.
    const rejected = createScaffoldSpecifierResolver(platform);

    expect(rejected).toBeTypeOf('function');
  });
});

describe('buildOwnerIndex', () => {
  const shell = (packages: ShellDefinition['packages']): ShellDefinition => ({
    dir: 'packages/9-public/@prisma/orm-framework',
    kind: 'platform',
    packages,
  });

  it('indexes each package against the shell that publishes it', () => {
    const index = buildOwnerIndex(
      new Map<ShellName, ShellDefinition>([
        ['@prisma/orm-framework', shell([{ dir: 'a', name: '@internal/a', entry: 'a' }])],
        ['@prisma/orm-family-sql', shell([{ dir: 'b', name: '@internal/b', entry: '' }])],
      ]),
    );

    expect(index.get('@internal/a')).toEqual({ shell: '@prisma/orm-framework', entry: 'a' });
    expect(index.get('@internal/b')).toEqual({ shell: '@prisma/orm-family-sql', entry: '' });
  });

  it('refuses a package claimed by two shells, which would publish it twice', () => {
    const duplicated = new Map<ShellName, ShellDefinition>([
      ['@prisma/orm-framework', shell([{ dir: 'a', name: '@internal/a', entry: 'a' }])],
      ['@prisma/orm-family-sql', shell([{ dir: 'a2', name: '@internal/a', entry: 'a' }])],
    ]);

    expect(() => buildOwnerIndex(duplicated)).toThrow(ImportRootError);
    expect(() => buildOwnerIndex(duplicated)).toThrow(
      /@internal\/a is mapped to both @prisma\/orm-framework and @prisma\/orm-family-sql/,
    );
  });
});

describe('importedSpecifiers', () => {
  it('finds every form generated code names a module with', () => {
    const source = [
      "import type { Contract } from '@internal/contract/types';",
      'import {',
      '  Migration,',
      "} from '@internal/postgres/migration';",
      `import Other from "@internal/double-quoted";`,
      "import '@internal/side-effect';",
      "type Ref = import('@internal/inline-type').Thing;",
      "export { x } from '@internal/re-exported';",
      'import endContract from \'../../snapshots/abc/contract.json\' with { type: "json" };',
    ].join('\n');

    expect(importedSpecifiers(source)).toEqual([
      '@internal/contract/types',
      '@internal/postgres/migration',
      '@internal/double-quoted',
      '@internal/side-effect',
      '@internal/inline-type',
      '@internal/re-exported',
      '../../snapshots/abc/contract.json',
    ]);
  });

  it('finds nothing in a source with no imports', () => {
    expect(importedSpecifiers('export type Contract = { readonly a: 1 };')).toEqual([]);
  });

  it('ignores quoted strings that are data rather than module names', () => {
    // The emitted `contract.d.ts` mirrors `contract.json`'s extensions block,
    // which carries `package: '@internal/…'` as a string literal type. It
    // is contract data, not an import, and must not be rewritten or audited.
    const source = "export type X = { readonly package: '@internal/extension-pgvector' };";

    expect(importedSpecifiers(source)).toEqual([]);
  });
});

describe('transitiveImports', () => {
  const importing = (...specifiers: string[]) =>
    specifiers.map((s) => `import { x } from '${s}';`).join('\n');

  it('reports nothing when every import is a direct dependency', () => {
    const clean = importing(
      '@prisma/orm-postgres/family-contract/types',
      '@prisma/orm-extension-pgvector/codec-types',
    );

    expect(transitiveImports(clean, postgresFacade)).toEqual([]);
  });

  it('allows @prisma/cli-engine, which init installs into the application directly', () => {
    const configImport = importing('@prisma/cli-engine', '@prisma/orm-postgres/config');

    expect(transitiveImports(configImport, postgresFacade)).toEqual([]);
  });

  it('reports a published package the application does not install directly', () => {
    const leaky = importing(
      '@prisma/orm-postgres/contract/types',
      '@prisma/orm-family-sql/contract/types',
      '@prisma/orm-toolchain/cli/migration-cli',
    );

    expect(transitiveImports(leaky, postgresFacade)).toEqual([
      '@prisma/orm-family-sql/contract/types',
      '@prisma/orm-toolchain/cli/migration-cli',
    ]);
  });

  it('reports a facade under the platform root, which a decomposed install lacks', () => {
    const leaky = importing(
      '@prisma/orm-family-sql/contract/types',
      '@prisma/orm-postgres/migration',
    );

    expect(transitiveImports(leaky, platform)).toEqual(['@prisma/orm-postgres/migration']);
  });

  it('reports an internal name that escaped rewriting', () => {
    const leaky = importing('@prisma/orm-postgres/contract/types', '@internal/sql-contract/types');

    expect(transitiveImports(leaky, postgresFacade)).toEqual(['@internal/sql-contract/types']);
  });

  it('reports a side-effect import, which has no `from` clause to scan', () => {
    const leaky = "import '@prisma/orm-family-sql/runtime';";

    expect(transitiveImports(leaky, postgresFacade)).toEqual(['@prisma/orm-family-sql/runtime']);
  });

  it('leaves relative paths and third-party packages alone', () => {
    const source = importing('./contract', '../../snapshots/abc/contract.json', 'arktype', 'pg');

    expect(transitiveImports(source, platform)).toEqual([]);
  });

  it('reports nothing under the internal root, whose names are the repository’s own', () => {
    expect(
      transitiveImports(importing('@internal/sql-contract/types'), internalImportRoot),
    ).toEqual([]);
  });

  it('refuses a source whose imports it could not read rather than call it clean', () => {
    // A renderer that started quoting with backticks would otherwise make
    // every audited file look import-free, and the audit would pass on
    // output nobody had checked.
    const unscannable = 'import { Migration } from `@internal/postgres/migration`;';

    expect(() => transitiveImports(unscannable, postgresFacade)).toThrow(ImportRootError);
    expect(() => transitiveImports(unscannable, postgresFacade)).toThrow(/pass vacuously/);
  });

  it('accepts a genuinely import-free source', () => {
    expect(transitiveImports('export type X = 1;', postgresFacade)).toEqual([]);
  });

  it('accepts a source whose only "import" is prose in a comment', () => {
    const source = [
      '// Generated code must not import internals.',
      '// The emitter will import the contract types it needs.',
      '/* Nothing here imports anything; the word import is prose. */',
      'export type X = 1;',
    ].join('\n');

    expect(transitiveImports(source, postgresFacade)).toEqual([]);
  });

  it('accepts prose that names both keywords without a quoted specifier', () => {
    const source = '// Consumers import from the facade, never from a transitive dependency.\n';

    expect(transitiveImports(source, postgresFacade)).toEqual([]);
  });

  it('still refuses a bare side-effect import it could not read', () => {
    expect(() => transitiveImports('import `@internal/postgres/runtime`;', postgresFacade)).toThrow(
      /pass vacuously/,
    );
  });
});
