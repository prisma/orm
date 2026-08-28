import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createBiomeRuns, planWorkspaceLint } from './lint-workspaces.mjs';

let root;

function write(relativePath, contents) {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

function pkg(name, lint = true) {
  write(
    `packages/${name}/package.json`,
    JSON.stringify({ name, scripts: lint ? { lint: 'biome check . --error-on-warnings' } : {} }),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lint-workspaces-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('planWorkspaceLint', () => {
  test('batches root-equivalent configs and isolates custom configs', () => {
    pkg('inherited');
    write('packages/inherited/biome.jsonc', JSON.stringify({ $schema: 'schema', extends: '//' }));
    pkg('root-config');
    pkg('custom');
    write(
      'packages/custom/biome.jsonc',
      JSON.stringify({ extends: '//', javascript: { globals: ['CUSTOM'] } }),
    );
    pkg('not-linted', false);

    assert.deepEqual(planWorkspaceLint(root, 'packages'), {
      batched: ['packages/inherited', 'packages/root-config'],
      custom: ['packages/custom'],
    });
  });
});

describe('createBiomeRuns', () => {
  test('creates one root batch and one run per custom config', () => {
    assert.deepEqual(
      createBiomeRuns(root, {
        batched: ['packages/a', 'packages/b'],
        custom: ['packages/custom'],
      }),
      [
        {
          cwd: root,
          args: [
            'check',
            '--config-path',
            join(root, 'biome.jsonc'),
            '--error-on-warnings',
            'packages/a',
            'packages/b',
          ],
        },
        {
          cwd: join(root, 'packages/custom'),
          args: ['check', '.', '--error-on-warnings'],
        },
      ],
    );
  });
});
