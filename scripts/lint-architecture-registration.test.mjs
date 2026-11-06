import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  checkedSourceFiles,
  findRegistrationProblems,
  main,
} from './lint-architecture-registration.mjs';

let base;

function write(path, content = '') {
  mkdirSync(join(base, path, '..'), { recursive: true });
  writeFileSync(join(base, path), content);
}

function register(globs) {
  write(
    'architecture.config.json',
    JSON.stringify({
      packages: globs.map((glob) => ({ glob, domain: 'd', layer: 'l', plane: 'shared' })),
    }),
  );
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'architecture-registration-'));
  write('packages/a/src/core/x.ts');
  write('packages/a/src/core/migrations/y.ts');
  write('packages/a/src/exports/control.ts');
  write('packages/a/src/core/x.test.ts');
  write('packages/a/src/types.d.ts');
  write('packages/a/test/z.ts');
  write('packages/a/vitest.config.ts');
  write('packages/a/dist/index.mjs');
  write('packages/a/node_modules/dep/src/index.ts');
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('checkedSourceFiles', () => {
  test('lists the files under src/ that dependency-cruiser checks', () => {
    assert.deepEqual(checkedSourceFiles(base), [
      'packages/a/src/core/migrations/y.ts',
      'packages/a/src/core/x.ts',
      'packages/a/src/exports/control.ts',
    ]);
  });
});

describe('findRegistrationProblems', () => {
  const files = [
    'packages/a/src/core/migrations/y.ts',
    'packages/a/src/core/x.ts',
    'packages/a/src/exports/control.ts',
  ];

  test('accepts files that each match one glob', () => {
    const configs = [
      'packages/a/src/core/*.ts',
      'packages/a/src/core/migrations/**',
      'packages/a/src/exports/control.ts',
    ];
    assert.deepEqual(
      findRegistrationProblems(
        configs.map((glob) => ({ glob })),
        files,
      ),
      { unregistered: [], overlapping: [] },
    );
  });

  test('reports a file that matches no glob', () => {
    const configs = ['packages/a/src/core/*.ts', 'packages/a/src/core/migrations/**'];
    assert.deepEqual(
      findRegistrationProblems(
        configs.map((glob) => ({ glob })),
        files,
      ),
      {
        unregistered: ['packages/a/src/exports/control.ts'],
        overlapping: [],
      },
    );
  });

  test('reports a file that matches more than one glob', () => {
    const configs = [
      'packages/a/src/core/**',
      'packages/a/src/core/migrations/**',
      'packages/a/src/exports/control.ts',
    ];
    assert.deepEqual(
      findRegistrationProblems(
        configs.map((glob) => ({ glob })),
        files,
      ),
      {
        unregistered: [],
        overlapping: [
          {
            file: 'packages/a/src/core/migrations/y.ts',
            globs: ['packages/a/src/core/**', 'packages/a/src/core/migrations/**'],
          },
        ],
      },
    );
  });
});

describe('main', () => {
  test('exits 1 when a file is unregistered', () => {
    register(['packages/a/src/core/**']);
    assert.equal(main(base), 1);
  });

  test('exits 0 when every file matches one glob', () => {
    register([
      'packages/a/src/core/*.ts',
      'packages/a/src/core/migrations/**',
      'packages/a/src/exports/**',
    ]);
    assert.equal(main(base), 0);
  });

  test('passes on the repository', () => {
    assert.ok(checkedSourceFiles().length > 0);
    assert.equal(main(), 0);
  });
});
