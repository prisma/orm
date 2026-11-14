import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  contractSnapshotJsonSpecifier,
  contractSnapshotTypesSpecifier,
} from '@internal/framework-components/control';
import { singleLineDeclarations } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';

import {
  applyMigrationsRootPlan,
  discoverMigrationsRoots,
  formatSummary,
  MigrationLayoutAbortError,
  migrateMigrationsRoots,
  planMigrationsRoot,
  rewriteImportSpecifiers,
} from './migrate-migrations-layout.mjs';

function fakeHash(seed) {
  return createHash('sha256').update(seed).digest('hex');
}

function fakeContractJson(storageHash, extra = {}) {
  return { storage: { storageHash }, namespaces: {}, ...extra };
}

const CONTRACT_DTS = 'export interface Contract {\n  readonly storageHash: string;\n}\n';

function baselineMigrationTs() {
  return (
    "import { MigrationCLI } from '@internal/cli/migration-cli';\n" +
    "import { Migration } from '@internal/family-mongo/migration';\n" +
    "import type { Contract as End } from './end-contract';\n" +
    "import endContract from './end-contract.json' with { type: 'json' };\n" +
    '\n' +
    'class M extends Migration<never, End> {\n' +
    '  override readonly endContractJson = endContract;\n' +
    '  override get operations() {\n' +
    '    return [];\n' +
    '  }\n' +
    '}\n' +
    '\n' +
    'export default M;\n' +
    'MigrationCLI.run(import.meta.url, M);\n'
  );
}

function deltaMigrationTs() {
  return (
    "import { MigrationCLI } from '@internal/cli/migration-cli';\n" +
    "import { Migration } from '@internal/family-mongo/migration';\n" +
    "import type { Contract as End } from './end-contract';\n" +
    "import endContract from './end-contract.json' with { type: 'json' };\n" +
    "import type { Contract as Start } from './start-contract';\n" +
    "import startContract from './start-contract.json' with { type: 'json' };\n" +
    '\n' +
    'class M extends Migration<Start, End> {\n' +
    '  override readonly startContractJson = startContract;\n' +
    '  override readonly endContractJson = endContract;\n' +
    '  override get operations() {\n' +
    '    return [];\n' +
    '  }\n' +
    '}\n' +
    '\n' +
    'export default M;\n' +
    'MigrationCLI.run(import.meta.url, M);\n'
  );
}

async function writeMigrationPackage(dir, { from, to, ts }) {
  await mkdir(dir, { recursive: true });
  const ops = [];
  const metadataSansHash = {
    from,
    to,
    providedInvariants: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const migrationHash = computeMigrationHash(metadataSansHash, ops);
  const metadata = { ...metadataSansHash, migrationHash };

  await writeFile(join(dir, 'migration.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  await writeFile(join(dir, 'ops.json'), `${JSON.stringify(ops, null, 2)}\n`);
  await writeFile(join(dir, 'migration.ts'), ts);

  await writeFile(join(dir, 'end-contract.json'), `${JSON.stringify(fakeContractJson(to))}\n`);
  await writeFile(join(dir, 'end-contract.d.ts'), CONTRACT_DTS);

  if (from !== null) {
    await writeFile(
      join(dir, 'start-contract.json'),
      `${JSON.stringify(fakeContractJson(from))}\n`,
    );
    await writeFile(join(dir, 'start-contract.d.ts'), CONTRACT_DTS);
  }

  return metadata;
}

/**
 * Two-migration app-space chain plus a one-package extension space with a
 * per-space head contract, mirroring the shapes in
 * `examples/prisma-8-demo/migrations`. Returns the hashes used so tests
 * can locate the resulting store entries.
 */
async function buildFixture(root) {
  const hashA = fakeHash('contract-a');
  const hashB = fakeHash('contract-b');
  const hashC = fakeHash('contract-c');

  const pkg1Dir = join(root, 'app', '20260101T0000_initial');
  const pkg2Dir = join(root, 'app', '20260102T0000_second');
  const extPkgDir = join(root, 'ext', '20260103T0000_ext_migration');
  const extDir = join(root, 'ext');

  await writeMigrationPackage(pkg1Dir, { from: null, to: hashA, ts: baselineMigrationTs() });
  await writeMigrationPackage(pkg2Dir, { from: hashA, to: hashB, ts: deltaMigrationTs() });
  await writeMigrationPackage(extPkgDir, { from: null, to: hashC, ts: baselineMigrationTs() });

  await mkdir(join(extDir, 'refs'), { recursive: true });
  await writeFile(
    join(extDir, 'refs', 'head.json'),
    `${JSON.stringify({ hash: hashC, invariants: [] }, null, 2)}\n`,
  );
  await writeFile(join(extDir, 'contract.json'), `${JSON.stringify(fakeContractJson(hashC))}\n`);
  await writeFile(join(extDir, 'contract.d.ts'), CONTRACT_DTS);

  return { hashA, hashB, hashC, pkg1Dir, pkg2Dir, extPkgDir, extDir };
}

async function writeRefPair(refsDir, name, hash) {
  await writeFile(
    join(refsDir, `${name}.json`),
    `${JSON.stringify({ hash, invariants: [] }, null, 2)}\n`,
  );
  await writeFile(
    join(refsDir, `${name}.contract.json`),
    `${JSON.stringify(fakeContractJson(hash))}\n`,
  );
  await writeFile(join(refsDir, `${name}.contract.d.ts`), CONTRACT_DTS);
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'migrate-migrations-layout-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function storageHashHexOf(hash) {
  return hash;
}

describe('rewriteImportSpecifiers', () => {
  it('rewrites a baseline end-only import block', () => {
    const toHash = fakeHash('aa');
    const rewritten = rewriteImportSpecifiers(baselineMigrationTs(), {
      snapshotsImportPath: '../../snapshots',
      toHash,
      fromHash: null,
    });
    assert.equal(rewritten.includes("'./end-contract"), false);
    assert.equal(
      rewritten.includes(`'${contractSnapshotJsonSpecifier('../../snapshots', toHash)}'`),
      true,
    );
    assert.equal(
      rewritten.includes(`'${contractSnapshotTypesSpecifier('../../snapshots', toHash)}'`),
      true,
    );
  });

  it('rewrites a start+end import block, leaving symbols untouched', () => {
    const toHash = fakeHash('bb');
    const fromHash = fakeHash('aa');
    const rewritten = rewriteImportSpecifiers(deltaMigrationTs(), {
      snapshotsImportPath: '../snapshots',
      toHash,
      fromHash,
    });
    assert.equal(rewritten.includes("'./start-contract"), false);
    assert.equal(rewritten.includes("'./end-contract"), false);
    assert.equal(
      rewritten.includes(`'${contractSnapshotJsonSpecifier('../snapshots', toHash)}'`),
      true,
    );
    assert.equal(
      rewritten.includes(`'${contractSnapshotTypesSpecifier('../snapshots', fromHash)}'`),
      true,
    );
    assert.match(rewritten, /import startContract from/);
    assert.match(rewritten, /class M extends Migration<Start, End>/);
  });
});

describe('migrateMigrationsRoots — happy path', () => {
  it('populates the store, deletes siblings, rewrites migration.ts, leaves migration.json/head.json byte-identical', async () => {
    await withTempDir(async (root) => {
      const { hashA, hashB, hashC, pkg1Dir, pkg2Dir, extPkgDir, extDir } = await buildFixture(root);

      const migrationJsonABefore = await readFile(join(pkg1Dir, 'migration.json'), 'utf8');
      const migrationJsonBBefore = await readFile(join(pkg2Dir, 'migration.json'), 'utf8');
      const headRefBefore = await readFile(join(extDir, 'refs', 'head.json'), 'utf8');

      const [summary] = await migrateMigrationsRoots([root]);

      assert.equal(summary.packagesProcessed, 3);
      assert.equal(summary.spacesProcessed, 1);
      // hashA, hashB, hashC are each written once, by the first side that
      // reaches them: pkg1's `to`, pkg2's `to`, and extPkg's `to`. Two later
      // write-if-absent hits reuse those entries: pkg2's `from` (== hashA,
      // pkg1's `to`) and the space's head (== hashC, extPkg's `to`).
      assert.equal(summary.storeEntriesWritten, 3);
      assert.equal(summary.storeEntriesAlreadyPresent, 2);
      assert.equal(summary.filesDeleted, 2 + 4 + 2 + 2); // pkg1(2) + pkg2(4) + extPkg(2) + space(2)
      assert.equal(summary.migrationHashesVerified, 3);

      for (const hash of [hashA, hashB, hashC]) {
        const storeDir = join(root, 'snapshots', storageHashHexOf(hash));
        const contractJsonPath = join(storeDir, 'contract.json');
        const contractDtsPath = join(storeDir, 'contract.d.ts');
        const contractJsonText = await readFile(contractJsonPath, 'utf8');
        const contractDtsText = await readFile(contractDtsPath, 'utf8');

        assert.deepEqual(JSON.parse(contractJsonText), fakeContractJson(hash));
        // canonicalizeJson output is a single line; exactly one trailing newline.
        assert.equal(contractJsonText.endsWith('\n'), true);
        assert.equal(contractJsonText.trimEnd().includes('\n'), false);
        assert.equal(contractDtsText, singleLineDeclarations(CONTRACT_DTS));
      }

      for (const [dir, names] of [
        [pkg1Dir, ['end-contract.json', 'end-contract.d.ts']],
        [
          pkg2Dir,
          ['end-contract.json', 'end-contract.d.ts', 'start-contract.json', 'start-contract.d.ts'],
        ],
        [extDir, ['contract.json', 'contract.d.ts']],
      ]) {
        for (const name of names) {
          await assert.rejects(readFile(join(dir, name)), { code: 'ENOENT' });
        }
      }

      const pkg1Ts = await readFile(join(pkg1Dir, 'migration.ts'), 'utf8');
      assert.equal(pkg1Ts.includes("'./end-contract"), false);
      assert.equal(
        pkg1Ts.includes(`'${contractSnapshotJsonSpecifier('../../snapshots', hashA)}'`),
        true,
      );
      assert.equal(
        pkg1Ts.includes(`'${contractSnapshotTypesSpecifier('../../snapshots', hashA)}'`),
        true,
      );

      const pkg2Ts = await readFile(join(pkg2Dir, 'migration.ts'), 'utf8');
      assert.equal(pkg2Ts.includes("'./end-contract"), false);
      assert.equal(pkg2Ts.includes("'./start-contract"), false);
      assert.equal(
        pkg2Ts.includes(`'${contractSnapshotJsonSpecifier('../../snapshots', hashB)}'`),
        true,
      );
      assert.equal(
        pkg2Ts.includes(`'${contractSnapshotJsonSpecifier('../../snapshots', hashA)}'`),
        true,
      );

      const extPkgTs = await readFile(join(extPkgDir, 'migration.ts'), 'utf8');
      assert.equal(
        extPkgTs.includes(`'${contractSnapshotJsonSpecifier('../../snapshots', hashC)}'`),
        true,
      );

      assert.equal(await readFile(join(pkg1Dir, 'migration.json'), 'utf8'), migrationJsonABefore);
      assert.equal(await readFile(join(pkg2Dir, 'migration.json'), 'utf8'), migrationJsonBBefore);
      assert.equal(await readFile(join(extDir, 'refs', 'head.json'), 'utf8'), headRefBefore);
    });
  });

  it('is a no-op on a second run over an already-migrated tree', async () => {
    await withTempDir(async (root) => {
      await buildFixture(root);
      await migrateMigrationsRoots([root]);

      const [summary] = await migrateMigrationsRoots([root]);

      assert.equal(summary.packagesProcessed, 3);
      assert.equal(summary.spacesProcessed, 0); // per-space contract.json already deleted
      assert.equal(summary.storeEntriesWritten, 0);
      assert.equal(summary.storeEntriesAlreadyPresent, 0);
      assert.equal(summary.filesDeleted, 0);
      assert.equal(summary.migrationHashesVerified, 3);
    });
  });
});

describe('migrateMigrationsRoots — abort on inner hash mismatch', () => {
  it('aborts before writing or deleting anything, anywhere in the root', async () => {
    await withTempDir(async (root) => {
      const { pkg1Dir, pkg2Dir, extDir } = await buildFixture(root);

      // Corrupt pkg2's start-contract.json so its inner hash disagrees with
      // migration.json's recorded `from`. pkg1 (processed first) is fine —
      // this proves a later failure still prevents pkg1's already-planned
      // work from being applied.
      await writeFile(
        join(pkg2Dir, 'start-contract.json'),
        `${JSON.stringify(fakeContractJson(fakeHash('wrong-hash')))}\n`,
      );

      await assert.rejects(migrateMigrationsRoots([root]), MigrationLayoutAbortError);

      // Nothing written: no store directory at all.
      await assert.rejects(readdir(join(root, 'snapshots')), { code: 'ENOENT' });

      // Nothing deleted: every original sibling file is still present.
      for (const [dir, names] of [
        [pkg1Dir, ['end-contract.json', 'end-contract.d.ts']],
        [
          pkg2Dir,
          ['end-contract.json', 'end-contract.d.ts', 'start-contract.json', 'start-contract.d.ts'],
        ],
        [extDir, ['contract.json', 'contract.d.ts']],
      ]) {
        for (const name of names) {
          await assert.doesNotReject(readFile(join(dir, name)));
        }
      }

      // Nothing rewritten: migration.ts files still reference the old siblings.
      const pkg1Ts = await readFile(join(pkg1Dir, 'migration.ts'), 'utf8');
      assert.equal(pkg1Ts.includes("'./end-contract.json'"), true);
    });
  });

  it('planMigrationsRoot rejects and applyMigrationsRootPlan is never reached', async () => {
    await withTempDir(async (root) => {
      const { pkg1Dir } = await buildFixture(root);
      await writeFile(
        join(pkg1Dir, 'end-contract.json'),
        `${JSON.stringify(fakeContractJson(fakeHash('wrong-hash')))}\n`,
      );

      await assert.rejects(planMigrationsRoot(root), MigrationLayoutAbortError);
    });
  });
});

describe('migrateMigrationsRoots — ref-paired snapshot folding', () => {
  it('folds ref-paired snapshots into the store, deletes the pair, leaves the pointer untouched', async () => {
    await withTempDir(async (root) => {
      const { hashA, extDir } = await buildFixture(root);
      const hashD = fakeHash('contract-d');
      const refsDir = join(extDir, 'refs');
      // 'db' names hashA — already written to the store by pkg1's `to`
      // side, so folding it is a write-if-absent hit. 'staging' names a
      // hash no package uses, so folding it is the only writer.
      await writeRefPair(refsDir, 'db', hashA);
      await writeRefPair(refsDir, 'staging', hashD);

      const dbPointerBefore = await readFile(join(refsDir, 'db.json'), 'utf8');
      const stagingPointerBefore = await readFile(join(refsDir, 'staging.json'), 'utf8');

      const [summary] = await migrateMigrationsRoots([root]);

      assert.equal(summary.refsProcessed, 2);

      // Pointers are untouched — folding never writes them.
      assert.equal(await readFile(join(refsDir, 'db.json'), 'utf8'), dbPointerBefore);
      assert.equal(await readFile(join(refsDir, 'staging.json'), 'utf8'), stagingPointerBefore);

      // The paired snapshot files are gone.
      for (const name of [
        'db.contract.json',
        'db.contract.d.ts',
        'staging.contract.json',
        'staging.contract.d.ts',
      ]) {
        await assert.rejects(readFile(join(refsDir, name)), { code: 'ENOENT' });
      }

      // hashD's store entry exists only because the ref fold wrote it.
      const storeDir = join(root, 'snapshots', storageHashHexOf(hashD));
      assert.deepEqual(
        JSON.parse(await readFile(join(storeDir, 'contract.json'), 'utf8')),
        fakeContractJson(hashD),
      );
      assert.equal(
        await readFile(join(storeDir, 'contract.d.ts'), 'utf8'),
        singleLineDeclarations(CONTRACT_DTS),
      );

      // Second run: no ref pairs remain, so nothing to fold.
      const [summary2] = await migrateMigrationsRoots([root]);
      assert.equal(summary2.refsProcessed, 0);
      assert.equal(summary2.storeEntriesWritten, 0);
      assert.equal(summary2.filesDeleted, 0);
    });
  });

  it('aborts when a ref-paired contract.json has no sibling pointer', async () => {
    await withTempDir(async (root) => {
      const { extDir } = await buildFixture(root);
      const refsDir = join(extDir, 'refs');
      const hash = fakeHash('orphan');
      await writeFile(
        join(refsDir, 'orphan.contract.json'),
        `${JSON.stringify(fakeContractJson(hash))}\n`,
      );
      await writeFile(join(refsDir, 'orphan.contract.d.ts'), CONTRACT_DTS);

      await assert.rejects(migrateMigrationsRoots([root]), MigrationLayoutAbortError);

      await assert.rejects(readdir(join(root, 'snapshots')), { code: 'ENOENT' });
      await assert.doesNotReject(readFile(join(refsDir, 'orphan.contract.json')));
      await assert.doesNotReject(readFile(join(refsDir, 'orphan.contract.d.ts')));
    });
  });

  it('aborts when the ref-paired contract hash disagrees with the pointer', async () => {
    await withTempDir(async (root) => {
      const { hashA, extDir } = await buildFixture(root);
      const refsDir = join(extDir, 'refs');
      await writeRefPair(refsDir, 'db', hashA);
      await writeFile(
        join(refsDir, 'db.contract.json'),
        `${JSON.stringify(fakeContractJson(fakeHash('wrong-hash')))}\n`,
      );

      await assert.rejects(migrateMigrationsRoots([root]), MigrationLayoutAbortError);

      await assert.rejects(readdir(join(root, 'snapshots')), { code: 'ENOENT' });
      await assert.doesNotReject(readFile(join(refsDir, 'db.json')));
      await assert.doesNotReject(readFile(join(refsDir, 'db.contract.json')));
    });
  });

  it('aborts when the ref-paired contract.d.ts is missing', async () => {
    await withTempDir(async (root) => {
      const { extDir } = await buildFixture(root);
      const refsDir = join(extDir, 'refs');
      const hash = fakeHash('nodts');
      await writeFile(
        join(refsDir, 'nodts.json'),
        `${JSON.stringify({ hash, invariants: [] }, null, 2)}\n`,
      );
      await writeFile(
        join(refsDir, 'nodts.contract.json'),
        `${JSON.stringify(fakeContractJson(hash))}\n`,
      );

      await assert.rejects(migrateMigrationsRoots([root]), MigrationLayoutAbortError);

      await assert.rejects(readdir(join(root, 'snapshots')), { code: 'ENOENT' });
      await assert.doesNotReject(readFile(join(refsDir, 'nodts.contract.json')));
    });
  });
});

describe('discoverMigrationsRoots', () => {
  it('finds a deep consumer-project root via app/*/migration.json, not its space subdir', async () => {
    await withTempDir(async (start) => {
      const root = join(start, 'examples', 'demo', 'migrations');
      await buildFixture(root);

      const roots = await discoverMigrationsRoots(start);

      assert.deepEqual(roots, [root]);
    });
  });

  it('finds a shallow extension-repo root via */migration.json', async () => {
    await withTempDir(async (start) => {
      const root = join(start, 'packages', '3-extensions', 'demo-ext', 'migrations');
      await writeMigrationPackage(join(root, '20260101T0000_initial'), {
        from: null,
        to: fakeHash('shallow-a'),
        ts: baselineMigrationTs(),
      });

      const roots = await discoverMigrationsRoots(start);

      assert.deepEqual(roots, [root]);
    });
  });

  it('ignores a directory named migrations with no migration packages inside', async () => {
    await withTempDir(async (start) => {
      await mkdir(join(start, 'docs', 'migrations'), { recursive: true });
      await writeFile(join(start, 'docs', 'migrations', 'notes.md'), '# not a migrations root\n');

      const roots = await discoverMigrationsRoots(start);

      assert.deepEqual(roots, []);
    });
  });
});

describe('formatSummary', () => {
  it('renders per-root and total lines', () => {
    const text = formatSummary([
      {
        root: '/repo/examples/demo/migrations',
        packagesProcessed: 2,
        spacesProcessed: 1,
        refsProcessed: 2,
        storeEntriesWritten: 3,
        storeEntriesAlreadyPresent: 1,
        filesDeleted: 8,
        migrationHashesVerified: 2,
      },
    ]);

    assert.match(text, /processed 1 root\(s\)/);
    assert.match(text, /refs: 2/);
    assert.match(text, /store writes: 3 \(1 already present\)/);
    assert.match(text, /TOTAL: 1 root\(s\), 3 store writes \(1 already present\), 8 files deleted/);
  });
});

// applyMigrationsRootPlan is exercised indirectly above via
// migrateMigrationsRoots; this test drives it directly to pin its
// migrationHash re-verification against a hand-tampered ops.json.
describe('applyMigrationsRootPlan', () => {
  it('aborts if ops.json changes underneath a planned package (defence in depth)', async () => {
    await withTempDir(async (root) => {
      const { pkg1Dir } = await buildFixture(root);
      const plan = await planMigrationsRoot(root);

      await writeFile(join(pkg1Dir, 'ops.json'), '[{"op":"tampered"}]\n');

      await assert.rejects(applyMigrationsRootPlan(plan), MigrationLayoutAbortError);
    });
  });
});
