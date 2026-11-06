/**
 * What a consumer that mixes import roots actually gets.
 *
 * A published shell bundles a copy of each internal package it carries, so a
 * module reached through `@prisma/orm-*` and the same module reached through
 * its `@internal/*` workspace name are two objects, not one. Nothing about
 * that is visible to a type-checker or a passing unit test: the two copies
 * have identical shapes and identical behaviour, and they differ only where
 * identity is the point — a shared registry, an `instanceof`, a function
 * compared by reference.
 *
 * These tests make the difference observable, so the rule that an in-repo
 * consumer names one root or the other rests on demonstrated behaviour rather
 * than on an argument. `scripts/lint-single-import-root.mjs` enforces the
 * rule; this is the evidence for why it exists.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publicShells, type ShellName } from '@internal/publish-surface/shells';
import { installShells, packShell, runInScratch } from '@repo/tsdown/shell-testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');

/**
 * The module the assertions are made about: `@internal/contract`, which
 * every family and every target depends on, published inside
 * `@prisma/orm-framework` and republished by every facade.
 *
 * `ContractValidationError` is the witness. An error class is checked with
 * `instanceof`, so a second copy of the module does not throw or fail to
 * type-check — it just stops being caught.
 */
const witness = {
  workspaceDist: 'packages/1-framework/0-foundation/contract/dist/contract-validation-error.mjs',
  platform: '@prisma/orm-framework/contract/contract-validation-error',
  perFacade: [
    '@prisma/orm-postgres/contract/contract-validation-error',
    '@prisma/orm-sqlite/contract/contract-validation-error',
    '@prisma/orm-mysql/contract/contract-validation-error',
    '@prisma/orm-mongo/contract/contract-validation-error',
  ],
} as const;

const shells: ShellName[] = [
  '@prisma/orm-framework',
  '@prisma/orm-toolchain',
  '@prisma/orm-family-sql',
  '@prisma/orm-family-mongo',
  '@prisma/orm-target-postgres',
  '@prisma/orm-target-sqlite',
  '@prisma/orm-target-mysql',
  '@prisma/orm-target-mongo',
  '@prisma/orm-postgres',
  '@prisma/orm-sqlite',
  '@prisma/orm-mysql',
  '@prisma/orm-mongo',
];

describe('module identity across import roots', () => {
  let scratch: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'orm-module-identity-'));
    installShells(
      scratch,
      shells.map((name) => {
        const shell = publicShells.get(name);
        if (shell === undefined) throw new Error(`unknown shell ${name}`);
        return packShell(join(repoRoot, shell.dir), scratch);
      }),
    );
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  // The published surface is one graph. Postgres, SQLite and Mongo each reach
  // the framework's error class, and it is the same class every time, so an
  // application can combine them and `instanceof` still holds.
  it('gives every facade the framework shell’s own class', () => {
    const script = [
      "import { strict as assert } from 'node:assert';",
      `const platform = await import('${witness.platform}');`,
      'assert.equal(typeof platform.ContractValidationError, "function");',
      `for (const specifier of ${JSON.stringify(witness.perFacade)}) {`,
      '  const viaFacade = await import(specifier);',
      '  assert.equal(',
      '    viaFacade.ContractValidationError,',
      '    platform.ContractValidationError,',
      '    specifier + " is a second copy",',
      '  );',
      '}',
      "console.log('one class');",
    ].join('\n');

    expect(runInScratch(scratch, script)).toContain('one class');
  });

  // The other half, and the reason a consumer may not name both roots at
  // once: the workspace copy and the published copy behave identically and
  // are still different classes, so an error raised through one is not caught
  // by a `catch` written against the other.
  it('gives a consumer that also names the workspace package a second class', () => {
    const workspaceUrl = pathToFileURL(join(repoRoot, witness.workspaceDist)).href;
    const script = [
      "import { strict as assert } from 'node:assert';",
      `const published = await import('${witness.platform}');`,
      `const workspace = await import('${workspaceUrl}');`,
      'const raised = new workspace.ContractValidationError("boom", "structure");',
      // Same name, same code, same behaviour…
      'assert.equal(raised.name, "ContractValidationError");',
      'assert.equal(raised.code, new published.ContractValidationError("boom", "structure").code);',
      // …and still not the same class, which is the failure that shows up as
      // an uncaught error rather than as a build or type error.
      'assert.notEqual(published.ContractValidationError, workspace.ContractValidationError);',
      'assert.equal(raised instanceof published.ContractValidationError, false);',
      "console.log('two classes');",
    ].join('\n');

    expect(runInScratch(scratch, script)).toContain('two classes');
  });
});
