/**
 * What the in-repo consumers need from the published surface, and what the
 * facades do not carry.
 *
 * ADR 242 promises that an application installs one `@prisma/orm-<database>`
 * package and gets the stack. `examples/` and `apps/` are the check on that
 * promise: they are ordinary applications, and every workspace package they
 * name has to have a facade entrypoint before they can move to published
 * names. A consumer cannot move halfway — a shell bundles its own copy of
 * each internal package, so naming both roots at once means two copies of
 * everything they share (see
 * `packages/9-public/@prisma/orm-framework/test/module-identity.test.ts`).
 *
 * The list below is therefore a hole in the published surface, expressed as
 * code so it cannot silently grow. Each entry is an internal package that
 * some example imports and that no facade republishes. Closing one is a
 * `reexports` entry in `../src/shells`, or a decision that the surface should
 * not carry it — not a reason for the example to keep the workspace name.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createImportSpecifierResolver,
  type ImportRoot,
  importedSpecifiers,
} from '../src/import-roots';
import { publicShells, type ShellName } from '../src/shells';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const consumerRoots = ['examples', 'apps'];
const facades: ShellName[] = ['@prisma/orm-postgres', '@prisma/orm-sqlite', '@prisma/orm-mongo'];

const INCLUDED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'dist-tsc',
  'dist-tsc-prod',
  'coverage',
  '.tmp-output',
  '.next',
  '.turbo',
  'build',
]);
function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRECTORIES.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (INCLUDED_EXTENSIONS.has(extname(full))) yield full;
  }
}

function consumerSpecifiers(): ReadonlySet<string> {
  const specifiers = new Set<string>();
  for (const root of consumerRoots) {
    for (const file of walk(join(repoRoot, root))) {
      for (const specifier of importedSpecifiers(readFileSync(file, 'utf8'))) {
        if (specifier.startsWith('@internal/')) specifiers.add(specifier);
      }
    }
  }
  return specifiers;
}

function packageOf(specifier: string): string {
  const [scope, name] = specifier.split('/');
  return `${scope}/${name}`;
}

/** Whether any facade has a name for `specifier`. */
function anyFacadeCarries(specifier: string): boolean {
  return facades.some((facade) => {
    const root: ImportRoot = { mode: 'facade', facade };
    try {
      createImportSpecifierResolver(root)(specifier);
      return true;
    } catch {
      return false;
    }
  });
}

describe('the published surface against the applications that will consume it', () => {
  it('leaves the consumers naming no internal package', () => {
    // The hole this file used to enumerate is closed: every example and app
    // reaches everything it needs through its database package and its
    // extension packs. `scripts/lint-consumer-internal-imports.mjs` is what
    // keeps it closed; this asserts the surface is why it can be.
    const uncarried = [
      ...new Set([...consumerSpecifiers()].filter((s) => !anyFacadeCarries(s)).map(packageOf)),
    ].sort();

    expect(uncarried).toEqual([]);
  });

  // The contract-shaped surfaces do resolve, which is why generated
  // `contract.d.ts` and `migration.ts` can name published packages before the
  // hand-written source of the same application does.
  it('carries every surface emitted code names', () => {
    const emitted = [
      '@internal/contract/types',
      '@internal/framework-components/control',
      '@internal/sql-contract/types',
      '@internal/mongo-contract',
      '@internal/adapter-mongo/codec-types',
      '@internal/target-postgres/codec-types',
      '@internal/target-postgres/operation-types',
      '@internal/postgres/migration',
      '@internal/sqlite/migration',
      '@internal/target-mongo/migration',
    ];

    expect(emitted.filter((specifier) => !anyFacadeCarries(specifier))).toEqual([]);
  });

  // Extension packs are installed alongside the facade, so an example may
  // name them directly under the facade root.
  it('lets an application name an extension pack it installed', () => {
    const extensions = [...publicShells]
      .filter(([, shell]) => shell.kind === 'extension')
      .flatMap(([, shell]) => shell.packages.map((pkg) => pkg.name));

    expect(extensions.filter((name) => !anyFacadeCarries(name))).toEqual([]);
  });
});
