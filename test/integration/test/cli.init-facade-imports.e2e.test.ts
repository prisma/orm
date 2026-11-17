import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type AuthoringId,
  configFile,
  dbFile,
  starterSchema,
  type TargetId,
} from '../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates';

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
};

const CELLS: ReadonlyArray<{ readonly target: TargetId; readonly authoring: AuthoringId }> = [
  { target: 'postgres', authoring: 'psl' },
  { target: 'postgres', authoring: 'typescript' },
  { target: 'mongo', authoring: 'psl' },
  { target: 'mongo', authoring: 'typescript' },
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

function extractPrismaNextImports(source: string): readonly string[] {
  const matches = source.matchAll(/(?:\bfrom\s+|\bimport\s+)['"](@internal\/[^'"]+)['"]/g);
  return Array.from(new Set(Array.from(matches, (m) => m[1] as string)));
}

function templateSources(target: TargetId, authoring: AuthoringId): readonly string[] {
  const schemaPath = authoring === 'typescript' ? 'prisma/contract.ts' : 'prisma/contract.prisma';
  return [starterSchema(target, authoring), dbFile(target), configFile(target, `./${schemaPath}`)];
}

describe('init templates only depend on the facade package (TML-2485)', () => {
  describe('extractPrismaNextImports', () => {
    it('captures `import x from "pkg"` (named-binding form)', () => {
      const source = "import postgres from '@internal/postgres/runtime';\n";
      expect(extractPrismaNextImports(source)).toEqual(['@internal/postgres/runtime']);
    });

    it('captures `import "pkg"` (side-effect form)', () => {
      const source = "import '@internal/postgres/runtime';\n";
      expect(extractPrismaNextImports(source)).toEqual(['@internal/postgres/runtime']);
    });

    it('deduplicates repeated specifiers', () => {
      const source = [
        "import postgres from '@internal/postgres/runtime';",
        "import type { Foo } from '@internal/postgres/runtime';",
      ].join('\n');
      expect(extractPrismaNextImports(source)).toEqual(['@internal/postgres/runtime']);
    });
  });

  for (const { target, authoring } of CELLS) {
    const facade = FACADE_FOR_TARGET[target];

    describe(`${target} + ${authoring}`, () => {
      const allImports = templateSources(target, authoring).flatMap(extractPrismaNextImports);

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
