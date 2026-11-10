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

function mysqlFamily() {
  pkg('family/1-mysql/1-target', { name: '@internal/target-mysql' });
  pkg('family/1-mysql/2-adapter', {
    name: '@internal/adapter-mysql',
    dependencies: { '@internal/target-mysql': 'workspace:*' },
  });
  pkg('family/2-mariadb/1-target', {
    name: '@internal/target-mariadb',
    dependencies: { '@internal/target-mysql': 'workspace:*' },
  });
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'target-layering-'));
  database('alpha');
  database('beta');
  mysqlFamily();
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('findLayeringViolations', () => {
  test('accepts packages that depend only on lower-numbered folders', () => {
    assert.deepEqual(reasons(), []);
  });

  test('ignores development dependencies, which only tests use', () => {
    assert.ok(siblingDependencies(base).every(({ where }) => !where.includes('devDependencies')));
  });

  test('rejects a target source importing its own adapter, which is numbered higher', () => {
    pkg(
      'alpha/1-target',
      { name: '@internal/target-alpha' },
      { 'src/core/codecs.ts': "import { x } from '@internal/adapter-alpha/runtime';" },
    );
    assert.deepEqual(reasons(), [
      'alpha/1-target depends on alpha/2-adapter, and 2-adapter is not numbered lower than 1-target (packages/3-targets/alpha/1-target/src/core/codecs.ts)',
    ]);
  });

  test('rejects a manifest dependency on a package with the same number', () => {
    pkg('alpha/2-other', {
      name: '@internal/other-alpha',
      dependencies: { '@internal/adapter-alpha': 'workspace:*' },
    });
    assert.deepEqual(reasons(), [
      'alpha/2-other depends on alpha/2-adapter, and 2-adapter is not numbered lower than 2-other (package.json dependencies)',
    ]);
  });

  test('rejects a package depending on another database', () => {
    pkg(
      'beta/3-driver',
      { name: '@internal/driver-beta' },
      { 'src/driver.ts': "const target = await import('@internal/target-alpha');" },
    );
    assert.deepEqual(reasons(), [
      'beta/3-driver depends on alpha/1-target, a package of another database (packages/3-targets/beta/3-driver/src/driver.ts)',
    ]);
  });

  test('finds packages in nested numbered folders', () => {
    assert.deepEqual(
      targetPackages(base)
        .map(({ label }) => label)
        .filter((label) => label.startsWith('family/')),
      ['family/1-mysql/1-target', 'family/1-mysql/2-adapter', 'family/2-mariadb/1-target'],
    );
  });

  test('accepts a package in 2-mariadb depending on any package in 1-mysql', () => {
    pkg(
      'family/2-mariadb/1-target',
      { name: '@internal/target-mariadb' },
      { 'src/pack.ts': "import { a } from '@internal/adapter-mysql/control';" },
    );
    assert.deepEqual(reasons(), []);
  });

  test('rejects a package in 1-mysql depending on a package in 2-mariadb', () => {
    pkg(
      'family/1-mysql/2-adapter',
      { name: '@internal/adapter-mysql' },
      { 'src/adapter.ts': "import { t } from '@internal/target-mariadb/pack';" },
    );
    assert.deepEqual(reasons(), [
      'family/1-mysql/2-adapter depends on family/2-mariadb/1-target, and 2-mariadb is not numbered lower than 1-mysql (packages/3-targets/family/1-mysql/2-adapter/src/adapter.ts)',
    ]);
  });

  test('rejects a nested target depending on its own adapter', () => {
    pkg('family/1-mysql/1-target', {
      name: '@internal/target-mysql',
      dependencies: { '@internal/adapter-mysql': 'workspace:*' },
    });
    assert.deepEqual(reasons(), [
      'family/1-mysql/1-target depends on family/1-mysql/2-adapter, and 2-adapter is not numbered lower than 1-target (package.json dependencies)',
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
        databases: [...new Set(targetPackages(base).map(({ path }) => path[0]))],
        violations: reasons(),
      },
      { databases: ['alpha', 'beta', 'family'], violations: [] },
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
    const packages = targetPackages().map(({ label }) => label);
    assert.ok(packages.includes('postgres/1-target'));
    assert.ok(packages.includes('mongo/9-facade'));
    assert.ok(packages.includes('mysql/2-mariadb/9-facade'));
    const edges = siblingDependencies().map(({ from, to }) => `${from.label} -> ${to.label}`);
    assert.ok(edges.includes('postgres/2-adapter -> postgres/1-target'));
    assert.ok(edges.includes('mysql/2-mariadb/1-target -> mysql/1-mysql/1-target'));
  });

  test('has no target layering violations', () => {
    assert.deepEqual(
      findLayeringViolations().map(({ reason, where }) => `${reason} (${where})`),
      [],
    );
  });
});
