import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  findLayeringViolations,
  main,
  siblingDependencies,
  targetPackages,
} from './lint-target-layering.mjs';

let base;

function pkg(path, manifest, files = {}) {
  const dir = join(base, 'packages/3-targets', path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), source);
  }
}

function database(name) {
  pkg(`${name}/1-target`, { name: `@internal/target-${name}` });
  pkg(`${name}/2-adapter`, {
    name: `@internal/adapter-${name}`,
    dependencies: { [`@internal/target-${name}`]: 'workspace:*' },
    devDependencies: { [`@internal/driver-${name}`]: 'workspace:*' },
  });
  pkg(`${name}/3-driver`, { name: `@internal/driver-${name}` });
  pkg(
    `${name}/9-facade`,
    {
      name: `@internal/${name}`,
      dependencies: {
        [`@internal/target-${name}`]: 'workspace:*',
        [`@internal/adapter-${name}`]: 'workspace:*',
        [`@internal/driver-${name}`]: 'workspace:*',
      },
    },
    { 'src/runtime.ts': `import driver from '@internal/driver-${name}/runtime';` },
  );
}

function reasons() {
  return findLayeringViolations(base).map(({ reason, where }) => `${reason} (${where})`);
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'target-layering-'));
  database('alpha');
  database('beta');
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('findLayeringViolations', () => {
  test('accepts packages that depend only on lower numbers of their own database', () => {
    assert.deepEqual(reasons(), []);
  });

  test('ignores development dependencies, which only tests use', () => {
    assert.ok(siblingDependencies(base).every(({ where }) => !where.includes('devDependencies')));
  });

  test('rejects a target source importing its own adapter', () => {
    pkg(
      'alpha/1-target',
      { name: '@internal/target-alpha' },
      {
        'src/core/codecs.ts': "import { x } from '@internal/adapter-alpha/runtime';",
      },
    );
    assert.deepEqual(reasons(), [
      'alpha/1-target depends on alpha/2-adapter, which is not numbered lower (packages/3-targets/alpha/1-target/src/core/codecs.ts)',
    ]);
  });

  test('rejects a manifest dependency on a package with the same number', () => {
    pkg('alpha/2-other', {
      name: '@internal/other-alpha',
      dependencies: { '@internal/adapter-alpha': 'workspace:*' },
    });
    assert.deepEqual(reasons(), [
      'alpha/2-other depends on alpha/2-adapter, which is not numbered lower (package.json dependencies)',
    ]);
  });

  test('rejects a package depending on another database', () => {
    pkg(
      'beta/3-driver',
      { name: '@internal/driver-beta' },
      {
        'src/driver.ts': "const target = await import('@internal/target-alpha');",
      },
    );
    assert.deepEqual(reasons(), [
      'beta/3-driver depends on alpha/1-target, a package of another database (packages/3-targets/beta/3-driver/src/driver.ts)',
    ]);
  });

  test('does not take 0-shared, the code several targets share, for a database', () => {
    pkg('0-shared/1-shared-logic', { name: '@internal/shared-logic' });
    pkg(
      'alpha/1-target',
      { name: '@internal/target-alpha', dependencies: { '@internal/shared-logic': 'workspace:*' } },
      { 'src/core/codecs.ts': "import { x } from '@internal/shared-logic/now';" },
    );
    assert.deepEqual(
      {
        databases: [...new Set(targetPackages(base).map(({ database }) => database))],
        violations: reasons(),
      },
      { databases: ['alpha', 'beta'], violations: [] },
    );
  });

  test('main exits 1 on a peer dependency on the facade', () => {
    pkg('alpha/3-driver', {
      name: '@internal/driver-alpha',
      peerDependencies: { '@internal/alpha': '*' },
    });
    assert.equal(main(base), 1);
  });
});

describe('the repository', () => {
  test('finds every numbered package and its sibling dependencies', () => {
    const packages = targetPackages().map(({ database, folder }) => `${database}/${folder}`);
    assert.ok(packages.includes('postgres/1-target'));
    assert.ok(packages.includes('mongo/9-facade'));
    const edges = siblingDependencies().map(
      ({ from, to }) => `${from.database}/${from.folder} -> ${to.database}/${to.folder}`,
    );
    assert.ok(edges.includes('postgres/2-adapter -> postgres/1-target'));
  });

  test('has no target layering violations', () => {
    assert.deepEqual(
      findLayeringViolations().map(({ reason, where }) => `${reason} (${where})`),
      [],
    );
  });
});
