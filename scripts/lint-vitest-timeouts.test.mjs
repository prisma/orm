import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execPath } from 'node:process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { findDefaultTimeoutBudgets } from './lint-vitest-timeouts.mjs';

const SCRIPT_PATH = join(fileURLToPath(new URL('.', import.meta.url)), 'lint-vitest-timeouts.mjs');

const CONFIG_WITH_DEFAULT = [
  "import { timeouts } from '@repo/test-utils';",
  "import { defineConfig } from 'vitest/config';",
  '',
  'export default defineConfig({',
  '  test: {',
  '    testTimeout: timeouts.default,',
  '    hookTimeout: timeouts.default,',
  '  },',
  '});',
  '',
].join('\n');

const CONFIG_WITH_PACKAGE_DEFAULT = CONFIG_WITH_DEFAULT.replaceAll(
  'timeouts.default',
  'timeouts.vitestPackageDefault',
);

let repo;

function git(...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf-8' }).trim();
}

function writeRepoFile(relPath, content) {
  const full = join(repo, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function runLint() {
  return spawnSync(execPath, [SCRIPT_PATH], { cwd: repo, encoding: 'utf-8' });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'lint-vitest-timeouts-'));
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('findDefaultTimeoutBudgets', () => {
  it('names each test or hook budget set to timeouts.default', () => {
    assert.deepEqual(findDefaultTimeoutBudgets(CONFIG_WITH_DEFAULT), [
      { line: 6, setting: 'testTimeout' },
      { line: 7, setting: 'hookTimeout' },
    ]);
  });

  it('accepts the package default', () => {
    assert.deepEqual(findDefaultTimeoutBudgets(CONFIG_WITH_PACKAGE_DEFAULT), []);
  });

  it('leaves timeouts.default alone outside the two budget settings', () => {
    assert.deepEqual(findDefaultTimeoutBudgets('const wait = timeouts.default;\n'), []);
    assert.deepEqual(findDefaultTimeoutBudgets('    teardownTimeout: timeouts.default,\n'), []);
  });

  it('ignores a mention inside a comment or a string', () => {
    assert.deepEqual(
      findDefaultTimeoutBudgets(
        [
          '// testTimeout: timeouts.default is forbidden here',
          '/* hookTimeout: timeouts.default */',
          "const note = 'testTimeout: timeouts.default';",
          '    testTimeout: timeouts.vitestPackageDefault,',
        ].join('\n'),
      ),
      [],
    );
  });

  it('recognises a value wrapped onto the next line', () => {
    assert.deepEqual(
      findDefaultTimeoutBudgets('  test: {\n    hookTimeout:\n      timeouts.default,\n  },\n'),
      [{ line: 2, setting: 'hookTimeout' }],
    );
  });

  it('recognises a quoted key and a parenthesised value', () => {
    assert.deepEqual(
      findDefaultTimeoutBudgets(
        '    \'testTimeout\': timeouts.default,\n    "hookTimeout": (timeouts.default),\n',
      ),
      [
        { line: 1, setting: 'testTimeout' },
        { line: 2, setting: 'hookTimeout' },
      ],
    );
  });
});

describe('lint-vitest-timeouts', () => {
  it('fails on a tracked vitest config that budgets with timeouts.default', () => {
    writeRepoFile('packages/a/vitest.config.ts', CONFIG_WITH_DEFAULT);
    git('add', '-A');

    const result = runLint();

    assert.equal(result.status, 1);
    assert.match(result.stderr, /packages\/a\/vitest\.config\.ts:6 testTimeout/);
    assert.match(result.stderr, /packages\/a\/vitest\.config\.ts:7 hookTimeout/);
  });

  it('passes when every tracked config uses another budget', () => {
    writeRepoFile('packages/a/vitest.config.ts', CONFIG_WITH_PACKAGE_DEFAULT);
    writeRepoFile('packages/a/test/wait.test.ts', 'const wait = timeouts.default;\n');
    git('add', '-A');

    const result = runLint();

    assert.equal(result.status, 0, result.stderr);
  });

  it('scans a config written in JavaScript', () => {
    writeRepoFile(
      'packages/a/vitest.config.cjs',
      "const { timeouts } = require('@repo/test-utils');\nmodule.exports = {\n  test: {\n    hookTimeout: timeouts.default,\n  },\n};\n",
    );
    git('add', '-A');

    const result = runLint();

    assert.equal(result.status, 1);
    assert.match(result.stderr, /packages\/a\/vitest\.config\.cjs:4 hookTimeout/);
  });

  it('ignores an untracked config', () => {
    writeRepoFile('packages/a/vitest.config.ts', CONFIG_WITH_DEFAULT);

    const result = runLint();

    assert.equal(result.status, 0, result.stderr);
  });
});
