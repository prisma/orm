import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { findMixedPackages, main } from './lint-single-import-root.mjs';

let base;
let emptyTree;

function pkg(relativeDir, files) {
  const dir = join(base, relativeDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"name":"fixture"}');
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), source);
  }
}

before(() => {
  base = mkdtempSync(join(tmpdir(), 'single-import-root-'));
  emptyTree = mkdtempSync(join(tmpdir(), 'single-import-root-empty-'));

  pkg('examples/published-only', {
    'src/db.ts': "import postgres from '@prisma/orm-postgres/runtime';",
  });
  pkg('examples/internal-only', {
    'src/db.ts': "import postgres from '@internal/postgres/runtime';",
  });
  pkg('examples/mixed', {
    'src/db.ts': "import postgres from '@prisma/orm-postgres/runtime';",
    'src/query.ts': "import { budgets } from '@internal/sql-runtime';",
  });
  pkg('examples/parent', { 'src/app.ts': "import x from '@prisma/orm-mongo/runtime';" });
  pkg('examples/parent/nested', { 'src/app.ts': "import y from '@internal/mongo-orm';" });
  pkg('test/integration', {
    'test/query.ts': "import { budgets } from '@internal/sql-runtime';",
    'test/packaging/tarball.test.ts': "await import('@prisma/orm-postgres/runtime');",
  });
});

after(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(emptyTree, { recursive: true, force: true });
});

describe('findMixedPackages', () => {
  test('reports a package that names both roots', () => {
    const mixed = findMixedPackages(base, ['examples']).map((entry) => entry.pkg);
    assert.ok(mixed.includes('examples/mixed'));
  });

  test('leaves a package that names one root alone', () => {
    const mixed = findMixedPackages(base, ['examples']).map((entry) => entry.pkg);
    assert.ok(!mixed.includes('examples/published-only'));
    assert.ok(!mixed.includes('examples/internal-only'));
  });

  // A nested package installs its own dependencies and resolves on its own,
  // so its imports are not the parent's.
  test('attributes a nested package’s imports to the nested package', () => {
    const mixed = findMixedPackages(base, ['examples']).map((entry) => entry.pkg);
    assert.ok(!mixed.includes('examples/parent'));
    assert.ok(!mixed.includes('examples/parent/nested'));
  });

  test('names one offending specifier per root', () => {
    const [entry] = findMixedPackages(base, ['examples']).filter((e) => e.pkg === 'examples/mixed');
    assert.deepEqual([...entry.published.keys()], ['@prisma/orm-postgres/runtime']);
    assert.deepEqual([...entry.internal.keys()], ['@internal/sql-runtime']);
  });

  test('skips the packaging suites when attributing specifiers', () => {
    const mixed = findMixedPackages(base, ['test']).map((entry) => entry.pkg);
    assert.ok(!mixed.includes('test/integration'));
  });

  test('still reports the package when the same specifiers sit outside the exempt subtree', () => {
    const mixed = findMixedPackages(base, ['test'], []).map((entry) => entry.pkg);
    assert.ok(mixed.includes('test/integration'));
  });
});

describe('main(baseDir)', () => {
  test('fails on a tree holding a mixed package', () => {
    assert.equal(main(base), 1);
  });

  test('passes on a tree with no consumer roots at all', () => {
    assert.equal(main(emptyTree), 0);
  });
});
