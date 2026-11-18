import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execPath } from 'node:process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CONSUMER_SCOPES,
  findMatchingLines,
  findProseNames,
  internalSpecifiersOnLine,
  isScannableFile,
  isTransitionChecked,
  publishedEntries,
  publishedNamesOnLine,
  scanManifests,
} from './lint-consumer-internal-imports.mjs';

const SCRIPT_PATH = join(
  fileURLToPath(new URL('.', import.meta.url)),
  'lint-consumer-internal-imports.mjs',
);

// One matching line (the import), on line 2.
const FILE_WITH_ONE_HIT = "export const x = 1;\nimport { orm } from '@internal/sql-orm-client';\n";

let repo;

function git(...args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writeRepoFile(relPath, content) {
  const full = join(repo, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function commitAll(message) {
  git('add', '-A');
  git('commit', '-m', message);
}

function runScript(...args) {
  return spawnSync(execPath, [SCRIPT_PATH, ...args], { cwd: repo, encoding: 'utf-8' });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pn-lint-consumer-imports-'));
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('CONSUMER_SCOPES', () => {
  it('covers the consumer-shaped trees and no substrate suite', () => {
    assert.deepEqual(CONSUMER_SCOPES, [
      'examples',
      'apps',
      'test/e2e/framework',
      'test/integration/test/cli-journeys',
    ]);
  });
});

describe('isScannableFile', () => {
  it('accepts every module format a consumer ships', () => {
    for (const ext of ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']) {
      assert.equal(isScannableFile(`examples/app/src/main.${ext}`), true, ext);
    }
  });

  it('rejects files that are not modules', () => {
    assert.equal(isScannableFile('examples/app/contract.json'), false);
    assert.equal(isScannableFile('examples/app/README.md'), false);
  });

  it('accepts tests, configs, and generated files, which are consumer code too', () => {
    assert.equal(isScannableFile('examples/app/test/app.test.ts'), true);
    assert.equal(isScannableFile('examples/app/vitest.config.ts'), true);
    assert.equal(isScannableFile('examples/app/src/prisma/contract.d.ts'), true);
    assert.equal(isScannableFile('examples/app/migrations/app/x/migration.ts'), true);
  });

  it('rejects build output and installed dependencies', () => {
    assert.equal(isScannableFile('examples/app/dist/main.js'), false);
    assert.equal(isScannableFile('examples/app/node_modules/pkg/index.js'), false);
    assert.equal(isScannableFile('examples/app/coverage/report.js'), false);
  });
});

describe('internalSpecifiersOnLine', () => {
  it('reads a static import', () => {
    assert.deepEqual(internalSpecifiersOnLine("import { orm } from '@internal/sql-orm-client';"), [
      '@internal/sql-orm-client',
    ]);
  });

  it('reads a side-effect import, a dynamic import, and a re-export', () => {
    assert.deepEqual(internalSpecifiersOnLine("import '@internal/postgres/runtime';"), [
      '@internal/postgres/runtime',
    ]);
    assert.deepEqual(internalSpecifiersOnLine("type X = import('@internal/contract/types').C;"), [
      '@internal/contract/types',
    ]);
    assert.deepEqual(internalSpecifiersOnLine('export * from "@internal/utils/casts";'), [
      '@internal/utils/casts',
    ]);
  });

  it('ignores the published scope, relative paths, and third-party packages', () => {
    assert.deepEqual(internalSpecifiersOnLine("import x from '@prisma/orm-postgres/runtime';"), []);
    assert.deepEqual(internalSpecifiersOnLine("import x from './db';"), []);
    assert.deepEqual(internalSpecifiersOnLine("import { type } from 'arktype';"), []);
  });

  it('does not match the scope name outside an import position', () => {
    // A test asserting that emitted code does *not* name the internal scope has
    // to name it to say so; that is data, not a dependency.
    assert.deepEqual(internalSpecifiersOnLine("const INTERNAL_SCOPE = '@internal/';"), []);
  });
});

describe('findMatchingLines', () => {
  it('reports the line number and the specifier', () => {
    const matches = findMatchingLines(FILE_WITH_ONE_HIT);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].line, 2);
    assert.deepEqual(matches[0].specifiers, ['@internal/sql-orm-client']);
  });

  it('counts a line naming two internal specifiers once', () => {
    const content =
      "export { a } from '@internal/utils/casts'; export { b } from '@internal/ids';\n";
    const matches = findMatchingLines(content);
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0].specifiers, ['@internal/utils/casts', '@internal/ids']);
  });

  it('counts a multi-line import once, on the line that names the module', () => {
    const content = "import {\n  orm,\n  Collection,\n} from '@internal/sql-orm-client';\n";
    const matches = findMatchingLines(content);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].line, 4);
  });
});

describe('scanManifests', () => {
  function manifest(relPath, fields) {
    writeRepoFile(relPath, JSON.stringify({ name: 'app', ...fields }));
  }

  it('reads internal packages from dependencies and devDependencies', () => {
    manifest('examples/app/package.json', {
      dependencies: { '@internal/postgres': 'workspace:*', pg: '8' },
      devDependencies: { '@internal/cli': 'workspace:*' },
    });
    commitAll('two internal packages');

    assert.deepEqual(
      scanManifests(repo, 'examples').map((r) => `${r.field}:${r.package}`),
      ['dependencies:@internal/postgres', 'devDependencies:@internal/cli'],
    );
  });

  it('reads a consumer that publishes itself under the internal scope', () => {
    writeRepoFile('examples/app/package.json', JSON.stringify({ name: '@internal/example-app' }));
    commitAll('internally scoped consumer');

    assert.deepEqual(
      scanManifests(repo, 'examples').map((r) => `${r.field}:${r.package}`),
      ['name:@internal/example-app'],
    );
  });

  it('ignores published packages and third-party packages', () => {
    manifest('examples/app/package.json', {
      dependencies: { '@prisma/orm-postgres': '0.16.0', arktype: '^2', pg: 'catalog:' },
    });
    commitAll('one-database manifest');

    assert.deepEqual(scanManifests(repo, 'examples'), []);
  });

  it('ignores @internal/*, which is this repository’s own dev tooling', () => {
    manifest('examples/app/package.json', {
      devDependencies: { '@repo/tsconfig': 'workspace:*', '@repo/test-utils': 'workspace:*' },
    });
    commitAll('repo dev tooling only');

    assert.deepEqual(scanManifests(repo, 'examples'), []);
  });

  it('ignores manifests of installed dependencies', () => {
    manifest('examples/app/node_modules/pkg/package.json', {
      dependencies: { '@internal/cli': '0.16.0' },
    });
    commitAll('vendored manifest');

    assert.deepEqual(scanManifests(repo, 'examples'), []);
  });

  it('reads nested consumer packages, which install independently', () => {
    manifest('examples/monorepo/package.json', {
      dependencies: { '@internal/postgres': 'workspace:*' },
    });
    manifest('examples/monorepo/packages/audit/package.json', {
      dependencies: { '@internal/sql-contract': 'workspace:*' },
    });
    commitAll('nested manifests');

    assert.equal(scanManifests(repo, 'examples').length, 2);
  });
});

describe('lint-consumer-internal-imports', () => {
  it('passes a tree whose consumers name only published packages', () => {
    writeRepoFile(
      'examples/app/src/main.ts',
      "import { orm } from '@prisma/orm-postgres/orm-client';\n",
    );
    writeRepoFile(
      'examples/app/package.json',
      JSON.stringify({ name: 'app', dependencies: { '@prisma/orm-postgres': 'workspace:*' } }),
    );
    commitAll('one-database consumer');

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /names an @internal\/\* package/);
  });

  it('fails on a single planted import, and names the file and line', () => {
    writeRepoFile('examples/app/src/main.ts', FILE_WITH_ONE_HIT);
    commitAll('one planted import');

    const result = runScript();
    assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
    assert.match(result.stderr, /examples\/app\/src\/main\.ts:2: @internal\/sql-orm-client/);
    assert.match(result.stderr, /are not\npublished/);
  });

  it('fails on a single internal package in a manifest, with clean imports', () => {
    // The two measures are independent: importing nothing internal does not
    // make an install look like a real application's.
    writeRepoFile('examples/app/src/main.ts', "import x from '@prisma/orm-postgres/runtime';\n");
    writeRepoFile(
      'examples/app/package.json',
      JSON.stringify({ name: 'app', dependencies: { '@internal/cli': 'workspace:*' } }),
    );
    commitAll('clean imports, dirty manifest');

    const result = runScript();
    assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
    assert.match(result.stderr, /dependencies: @internal\/cli/);
  });

  it('fails on a planted import in every scope it governs', () => {
    for (const scope of CONSUMER_SCOPES) {
      writeRepoFile(`${scope}/app/src/main.ts`, FILE_WITH_ONE_HIT);
    }
    commitAll('one planted import per scope');

    const result = runScript();
    assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
    for (const scope of CONSUMER_SCOPES) {
      assert.match(result.stderr, new RegExp(`${scope}/app/src/main\\.ts:2`));
    }
  });

  it('says nothing about trees outside its scopes', () => {
    writeRepoFile('packages/lib/src/main.ts', FILE_WITH_ONE_HIT);
    writeRepoFile('test/integration/test/ports/pg.test.ts', FILE_WITH_ONE_HIT);
    commitAll('substrate suites name internal packages, which is their job');

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('ignores build output and installed dependencies', () => {
    writeRepoFile('examples/app/dist/main.js', FILE_WITH_ONE_HIT);
    writeRepoFile('examples/app/node_modules/pkg/index.js', FILE_WITH_ONE_HIT);
    commitAll('excluded-only occurrences');

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('--list prints every current site', () => {
    writeRepoFile('examples/app/src/main.ts', FILE_WITH_ONE_HIT);
    commitAll('one hit');

    const result = runScript('--list');
    assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
    assert.match(result.stdout, /examples\/app\/src\/main\.ts:2: @internal\/sql-orm-client/);
  });
});

describe('isTransitionChecked', () => {
  it('holds guides for releases after 8.0.0-rc.24 to the prose rule', () => {
    assert.equal(isTransitionChecked('8.0.0-rc.24-to-8.0.0-rc.25'), true);
    assert.equal(isTransitionChecked('8.0.0-rc.24-to-8.0'), true);
    assert.equal(isTransitionChecked('8.0-to-8.1'), true);
  });

  it('leaves guides up to 8.0.0-rc.24 as they shipped', () => {
    assert.equal(isTransitionChecked('8.0.0-rc.23-to-8.0.0-rc.24'), false);
    assert.equal(isTransitionChecked('8.0.0-rc.9-to-8.0.0-rc.10'), false);
    assert.equal(isTransitionChecked('0.17-to-8.0.0-rc.1'), false);
    assert.equal(isTransitionChecked('0.9-to-0.10'), false);
  });
});

describe('findProseNames', () => {
  const entries = new Map([['@prisma/orm-postgres', new Set(['@prisma/orm-postgres/runtime'])]]);
  const entriesOf = (name) => entries.get(name);

  it('names the internal package and the missing export it found', () => {
    const records = findProseNames(
      'Use `@internal/postgres/runtime`.\nOr `@prisma/orm-postgres/middleware`.\n',
      entriesOf,
    );
    assert.deepEqual(records, [
      { line: 1, internal: ['@internal/postgres/runtime'], unpublished: [] },
      { line: 2, internal: [], unpublished: ['@prisma/orm-postgres/middleware'] },
    ]);
  });

  it('accepts a published entry, a bare package name and a placeholder', () => {
    const content =
      '`@prisma/orm-postgres/runtime`, `@prisma/orm-postgres`, `@prisma/orm-<target>/runtime`, `@prisma/orm-family-*`\n';
    assert.deepEqual(findProseNames(content, entriesOf), []);
  });

  it('exempts detection patterns, and the exemption ends at the next key', () => {
    const content = [
      '---',
      'changes:',
      '  - id: first',
      '    detection:',
      '      glob: "**/*.ts"',
      '      matches:',
      "        - 'from [''\"]@internal/adapter-postgres/column-types'",
      '  - id: second',
      '    summary: |',
      '      Import it from `@internal/adapter-postgres/column-types`.',
      '---',
      '',
      'Prose naming `@internal/postgres/runtime`.',
      '',
    ].join('\n');
    assert.deepEqual(
      findProseNames(content, entriesOf).map((record) => record.line),
      [10, 13],
    );
  });

  it('reads a summary line as prose even when it repeats a detection pattern', () => {
    const content = [
      '---',
      'changes:',
      '  - id: first',
      '    summary: |',
      '      @internal/adapter-postgres/column-types',
      '    detection:',
      '      matches:',
      '        - "@internal/adapter-postgres/column-types"',
      '---',
      '',
    ].join('\n');
    assert.deepEqual(
      findProseNames(content, entriesOf).map((record) => record.line),
      [5],
    );
  });

  it('exempts every line of a multi-line detection value', () => {
    const content = [
      '---',
      'changes:',
      '  - id: first',
      '    detection:',
      '      matches:',
      '        - >-',
      "          from '@internal/adapter-postgres/column-types'",
      "          |from '@internal/postgres/runtime'",
      '    summary: Import it from `@internal/postgres/runtime`.',
      '---',
      '',
    ].join('\n');
    assert.deepEqual(
      findProseNames(content, entriesOf).map((record) => record.line),
      [9],
    );
  });
});

describe('prose scopes', () => {
  const guide = 'Import it from `@internal/postgres/runtime`.\n';

  it('reads the skill, pending fragments and newer guides, and skips older guides and codemods', () => {
    writeRepoFile('skills/prisma-8/references/runtime.md', guide);
    writeRepoFile('upgrade-instructions/pending/renamed/app/instructions.md', guide);
    writeRepoFile(
      'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.24-to-8.0.0-rc.25/instructions.md',
      guide,
    );
    writeRepoFile(
      'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.24-to-8.0.0-rc.25/scripts/fix/fix.ts',
      "const from = '@internal/postgres/runtime';\n",
    );
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.23-to-8.0.0-rc.24/instructions.md',
      guide,
    );
    commitAll('fixture');

    const result = runScript('--list');
    assert.equal(result.status, 1);
    const listed = result.stdout
      .trim()
      .split('\n')
      .map((line) => line.trim().split(':')[0]);
    assert.deepEqual(listed.sort(), [
      'skills/prisma-8/references/runtime.md',
      'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.24-to-8.0.0-rc.25/instructions.md',
      'upgrade-instructions/pending/renamed/app/instructions.md',
    ]);
    assert.match(result.stderr, /@internal\/postgres\/runtime \(not published\)/);
  });

  it('refuses file arguments rather than skipping the check', () => {
    const result = runScript('skills/prisma-8/SKILL.md');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /takes no file arguments/);
  });
});

describe('publishedNamesOnLine', () => {
  it('keeps a name with a character an entry cannot have, so it is resolved and fails', () => {
    assert.deepEqual(publishedNamesOnLine('Import `@prisma/orm-postgres/Runtime`.'), [
      '@prisma/orm-postgres/Runtime',
    ]);
    assert.deepEqual(publishedNamesOnLine('Import `@prisma/orm-postgres/control-api/`.'), [
      '@prisma/orm-postgres/control-api/',
    ]);
  });

  it('reads package.json as a subpath, drops a version, and trims sentence punctuation', () => {
    assert.deepEqual(publishedNamesOnLine('Read `@prisma/orm-postgres/package.json`.'), [
      '@prisma/orm-postgres/package.json',
    ]);
    assert.deepEqual(publishedNamesOnLine('<e.g. @prisma/orm-postgres@8.0.0-rc.24>'), [
      '@prisma/orm-postgres',
    ]);
    assert.deepEqual(publishedNamesOnLine('Install @prisma/orm-postgres.'), [
      '@prisma/orm-postgres',
    ]);
  });

  it('keeps only the package of a name inside a URL path', () => {
    assert.deepEqual(
      publishedNamesOnLine('See https://www.npmjs.com/package/@prisma/orm-postgres/v/8.0.0'),
      ['@prisma/orm-postgres'],
    );
  });

  it('skips placeholders and prefixes', () => {
    assert.deepEqual(
      publishedNamesOnLine(
        '`@prisma/orm-<target>/runtime`, `@prisma/orm-family-*`, `@prisma/orm-{postgres,mongo}`, n.startsWith("@prisma/orm-extension-")',
      ),
      [],
    );
  });
});

describe('publishedEntries', () => {
  it('maps exports to specifiers, including package.json and a wildcard export', () => {
    writeRepoFile(
      'packages/9-public/@prisma/orm-x/package.json',
      JSON.stringify({
        name: '@prisma/orm-x',
        exports: {
          '.': './dist/index.mjs',
          './runtime': './dist/runtime.mjs',
          './package.json': './package.json',
          './codecs/*': './dist/codecs/*.mjs',
        },
      }),
    );
    const entries = publishedEntries(repo, '@prisma/orm-x');
    assert.equal(entries.has('@prisma/orm-x'), true);
    assert.equal(entries.has('@prisma/orm-x/runtime'), true);
    assert.equal(entries.has('@prisma/orm-x/package.json'), true);
    assert.equal(entries.has('@prisma/orm-x/codecs/int4'), true);
    assert.equal(entries.has('@prisma/orm-x/codecs/'), false);
    assert.equal(entries.has('@prisma/orm-x/Runtime'), false);
    assert.equal(entries.has('@prisma/orm-x/runtime/'), false);
    assert.equal(publishedEntries(repo, '@prisma/orm-y'), undefined);
  });

  it('resolves prose against real manifests: a real export passes, a made-up one and an unknown package fail', () => {
    writeRepoFile(
      'packages/9-public/@prisma/orm-x/package.json',
      JSON.stringify({
        name: '@prisma/orm-x',
        exports: { '.': './i.mjs', './runtime': './r.mjs' },
      }),
    );
    writeRepoFile(
      'skills/prisma-8/references/runtime.md',
      'Use `@prisma/orm-x/runtime`, not `@prisma/orm-x/missing` or `@prisma/orm-y`.\n',
    );
    commitAll('fixture');
    const result = runScript();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /@prisma\/orm-x\/missing \(no such export\)/);
    assert.match(result.stderr, /@prisma\/orm-y \(no such export\)/);
    assert.doesNotMatch(result.stderr, /@prisma\/orm-x\/runtime/);
  });
});
