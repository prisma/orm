import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InitContribution } from '@internal/cli/init-contribution';
import type { ContractSourceFormat } from '@internal/config/config-types';
import mongoContribution from '@internal/mongo/init';
import mysqlContribution from '@internal/mysql/init';
import postgresContribution from '@internal/postgres/init';
import sqliteContribution from '@internal/sqlite/init';
import { normalize as portablePath, relative as portableRelative } from 'pathe';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { initConfigFile } from '../../../packages/1-framework/3-tooling/cli/src/commands/init/contract-entry';

type TargetId = 'postgres' | 'mongo' | 'sqlite' | 'mysql';
type AuthoringId = ContractSourceFormat;

const CONTRIBUTIONS: Record<TargetId, InitContribution> = {
  postgres: postgresContribution,
  mongo: mongoContribution,
  sqlite: sqliteContribution,
  mysql: mysqlContribution,
};

/**
 * Regression guard for TML-2485.
 *
 * When `prisma orm init --postgres|--mongo` ran on a default pnpm install
 * (`node-linker=isolated`), the generated `prisma/contract.ts` failed at
 * runtime with `ERR_MODULE_NOT_FOUND` because the templates imported from
 * `@internal/family-*`, `@internal/target-*`, and
 * `@internal/{mongo,sql}-contract-ts` directly. Those packages are
 * transitive deps of the facade (`@internal/{mongo,postgres}`), so pnpm
 * does not symlink them at the top of the user's `node_modules`.
 *
 * The contract is: every `@internal/...` import the templates emit must
 * be a subpath of the facade package, and every subpath used must be
 * declared in the facade package's published `exports` map (so it actually
 * resolves under Node's strict ESM resolver, not just by accident in a
 * hoisted layout).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

interface FacadeInfo {
  readonly packageName: string;
  readonly packageJsonPath: string;
}

const FACADE_FOR_TARGET: Record<TargetId, FacadeInfo> = {
  postgres: {
    packageName: '@internal/postgres',
    packageJsonPath: resolve(REPO_ROOT, 'packages/3-targets/postgres/9-facade/package.json'),
  },
  mongo: {
    packageName: '@internal/mongo',
    packageJsonPath: resolve(REPO_ROOT, 'packages/3-targets/mongo/9-facade/package.json'),
  },
  sqlite: {
    packageName: '@internal/sqlite',
    packageJsonPath: resolve(REPO_ROOT, 'packages/3-targets/sqlite/9-facade/package.json'),
  },
  mysql: {
    packageName: '@internal/mysql',
    packageJsonPath: resolve(REPO_ROOT, 'packages/3-targets/mysql/1-mysql/9-facade/package.json'),
  },
};

const CELLS: ReadonlyArray<{ readonly target: TargetId; readonly authoring: AuthoringId }> = [
  { target: 'postgres', authoring: 'psl' },
  { target: 'postgres', authoring: 'typescript' },
  { target: 'mongo', authoring: 'psl' },
  { target: 'mongo', authoring: 'typescript' },
  { target: 'sqlite', authoring: 'psl' },
  { target: 'sqlite', authoring: 'typescript' },
  { target: 'mysql', authoring: 'psl' },
  { target: 'mysql', authoring: 'typescript' },
];

interface FacadeExports {
  readonly subpaths: ReadonlySet<string>;
}

function readFacadeExports(packageJsonPath: string): FacadeExports {
  const raw = readFileSync(packageJsonPath, 'utf-8');
  const parsed = JSON.parse(raw) as { exports?: Record<string, unknown> };
  const exportsMap = parsed.exports ?? {};
  return {
    subpaths: new Set(
      Object.keys(exportsMap).filter((key) => key.startsWith('./') && key !== './package.json'),
    ),
  };
}

function extractInternalImports(source: string): readonly string[] {
  const matches = source.matchAll(/(?:\bfrom\s+|\bimport\s+)['"](@internal\/[^'"]+)['"]/g);
  return Array.from(new Set(Array.from(matches, (m) => m[1] as string)));
}

function templateSources(target: TargetId, authoring: AuthoringId): readonly string[] {
  const schemaPath = authoring === 'typescript' ? 'prisma/contract.ts' : 'prisma/contract.prisma';
  const contribution = CONTRIBUTIONS[target];
  return [
    contribution.starterContract(authoring),
    contribution.databaseFile(),
    initConfigFile({
      contribution,
      input: { kind: 'starter', mode: authoring, path: `./${schemaPath}` },
      owner: { packageName: target, unlisted: false },
      output: undefined,
    }),
  ];
}

describe('init templates only depend on the facade package (TML-2485)', () => {
  describe('extractInternalImports', () => {
    it('captures `import x from "pkg"` (named-binding form)', () => {
      const source = "import postgres from '@internal/postgres/runtime';\n";
      expect(extractInternalImports(source)).toEqual(['@internal/postgres/runtime']);
    });

    it('captures `import "pkg"` (side-effect form)', () => {
      const source = "import '@internal/postgres/runtime';\n";
      expect(extractInternalImports(source)).toEqual(['@internal/postgres/runtime']);
    });

    it('deduplicates repeated specifiers', () => {
      const source = [
        "import postgres from '@internal/postgres/runtime';",
        "import type { Foo } from '@internal/postgres/runtime';",
      ].join('\n');
      expect(extractInternalImports(source)).toEqual(['@internal/postgres/runtime']);
    });
  });

  for (const { target, authoring } of CELLS) {
    const facade = FACADE_FOR_TARGET[target];

    describe(`${target} + ${authoring}`, () => {
      const allImports = templateSources(target, authoring).flatMap(extractInternalImports);

      it('every @internal/* import targets the facade package', () => {
        expect(allImports.length).toBeGreaterThan(0);
        for (const specifier of allImports) {
          const [scope, packageName] = specifier.split('/');
          const baseName = `${scope}/${packageName}`;
          expect(
            baseName,
            `Import ${specifier} must come from the facade ${facade.packageName} so a default pnpm install (node-linker=isolated) resolves it. Re-export from the facade rather than importing the underlying package directly.`,
          ).toBe(facade.packageName);
        }
      });

      it('every subpath used is published in the facade exports map', () => {
        const facadeExports = readFacadeExports(facade.packageJsonPath);
        for (const specifier of allImports) {
          const subpath = `.${specifier.slice(facade.packageName.length)}`;
          expect(
            facadeExports.subpaths.has(subpath),
            `Subpath ${specifier} must be declared in ${facade.packageName}'s package.json "exports" so Node's ESM resolver can resolve it. Add a "${subpath}" entry to the facade and re-run pnpm install.`,
          ).toBe(true);
        }
      });
    });
  }
});

const FRAMEWORK_LOCATIONS = [
  'packages/1-framework/',
  'packages/9-public/@prisma/orm-framework/',
  'packages/9-public/@prisma/orm-toolchain/',
];

/**
 * The modules a built file imports, statically, dynamically or through a re-export, including
 * `export * as name from`; text inside its strings is not an import.
 */
function moduleSpecifiers(source: string): readonly string[] {
  const file = ts.createSourceFile(
    'built.mjs',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function isOurs(specifier: string): boolean {
  return (
    specifier.startsWith('.') ||
    specifier.startsWith('@internal/') ||
    specifier.startsWith('@prisma/orm-')
  );
}

/**
 * Every workspace file a built entrypoint loads, following its own and its workspace
 * dependencies' imports, as repository-relative paths. Third-party and Node modules are leaves.
 */
function workspaceModulesLoadedBy(entry: string): { files: string[]; specifiers: string[] } {
  const files: string[] = [];
  const specifiers: string[] = [];
  const pending = [realpathSync(entry)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || files.includes(portableRelative(REPO_ROOT, file))) continue;
    files.push(portableRelative(REPO_ROOT, file));
    for (const specifier of moduleSpecifiers(readFileSync(file, 'utf-8'))) {
      specifiers.push(specifier);
      if (!isOurs(specifier)) continue;
      const resolved = realpathSync(createRequire(file).resolve(specifier));
      if (!portablePath(resolved).includes('/node_modules/')) pending.push(resolved);
    }
  }
  return { files, specifiers };
}

describe('the init entrypoints import no framework code that runs', () => {
  const entrypoints = [
    {
      name: '@internal/postgres/init',
      dir: 'packages/3-targets/postgres/9-facade',
      statesServerVersion: true,
    },
    {
      name: '@internal/mongo/init',
      dir: 'packages/3-targets/mongo/9-facade',
      statesServerVersion: true,
    },
    {
      name: '@internal/sqlite/init',
      dir: 'packages/3-targets/sqlite/9-facade',
      statesServerVersion: false,
    },
    {
      name: '@internal/mysql/init',
      dir: 'packages/3-targets/mysql/1-mysql/9-facade',
      statesServerVersion: false,
    },
    {
      name: '@prisma/orm-postgres/init',
      dir: 'packages/9-public/@prisma/orm-postgres',
      statesServerVersion: true,
    },
    {
      name: '@prisma/orm-mongo/init',
      dir: 'packages/9-public/@prisma/orm-mongo',
      statesServerVersion: true,
    },
    {
      name: '@prisma/orm-sqlite/init',
      dir: 'packages/9-public/@prisma/orm-sqlite',
      statesServerVersion: false,
    },
    {
      name: '@prisma/orm-mysql/init',
      dir: 'packages/9-public/@prisma/orm-mysql',
      statesServerVersion: false,
    },
  ];

  it('finds a framework module that a built file imports', () => {
    const dir = mkdtempSync(join(__dirname, 'test-init-imports-'));
    try {
      const entry = join(dir, 'init.mjs');
      writeFileSync(
        entry,
        'const text = `import "./not-an-import.js"`;\nexport * as casts from "@internal/utils/casts";\n',
      );

      const { files, specifiers } = workspaceModulesLoadedBy(entry);

      expect(specifiers[0]).toBe('@internal/utils/casts');
      expect(specifiers).not.toContain('./not-an-import.js');
      expect(files.some((file) => file.startsWith('packages/1-framework/'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const { name, dir, statesServerVersion } of entrypoints) {
    it(`${name} loads only target and third-party modules`, () => {
      const { files, specifiers } = workspaceModulesLoadedBy(
        resolve(REPO_ROOT, dir, 'dist/init.mjs'),
      );

      expect(specifiers).toContain('pathe');
      expect(specifiers.some((specifier) => /\/server-version(-range)?$/.test(specifier))).toBe(
        statesServerVersion,
      );
      expect(
        files.filter((file) => FRAMEWORK_LOCATIONS.some((location) => file.startsWith(location))),
      ).toEqual([]);
    });
  }
});
