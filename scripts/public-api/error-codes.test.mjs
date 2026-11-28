import { deepStrictEqual, match, rejects, strictEqual, throws } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  codesInBuild,
  compareCodes,
  DownloadError,
  downloadRelease,
  main,
} from './error-codes.mjs';
import { RecordsError, validateRecords } from './records.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const work = join(here, '..', '..', 'wip', `error-codes-tests-${process.pid}`);
after(() => rmSync(work, { recursive: true, force: true }));

let folders = 0;
function folder() {
  const dir = join(work, String(folders++));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function build(files) {
  const dir = folder();
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

const record = (fields) => ({
  code: 'ORM.GONE',
  lastRelease: '8.0.0-rc.3',
  replacedBy: null,
  reason: 'nothing raises it any more',
  ...fields,
});

describe('codesInBuild', () => {
  it('finds codes in any quotes in built JavaScript, and nowhere else', () => {
    const dir = build({
      'dist/a.mjs': 'throw err("ORM.ARGUMENT_INVALID"); x(`RUNTIME.TIMEOUT`);',
      'dist/b.js': "f('CLI.USAGE')",
      'dist/c.cjs': 'g("DRIVER.NOT_CONNECTED")',
      'dist/a.d.mts': 'type T = "CONTRACT.ONLY_A_TYPE";',
      'README.md': '"CONFIG.ONLY_IN_PROSE"',
      'node_modules/dep/index.mjs': '"PLAN.FROM_A_DEPENDENCY"',
      'dist/d.mjs': '"NOTOURS.CODE" "ORM.lowercase" "ORM.MISMATCHED\'',
    });
    deepStrictEqual([...codesInBuild(dir)].sort(), [
      'CLI.USAGE',
      'DRIVER.NOT_CONNECTED',
      'ORM.ARGUMENT_INVALID',
      'RUNTIME.TIMEOUT',
    ]);
  });
});

describe('compareCodes', () => {
  const baseline = new Map([
    ['ORM.KEPT', ['@prisma/orm-a']],
    ['ORM.GONE', ['@prisma/orm-a', '@prisma/orm-b']],
  ]);

  it('passes when the build raises every code of the last release', () => {
    const result = compareCodes({
      version: '8.0.0-rc.3',
      baseline,
      current: new Set(['ORM.KEPT', 'ORM.GONE', 'ORM.NEW']),
      records: [],
    });
    deepStrictEqual(result, { missing: [], recorded: [], removable: [], problems: [] });
  });

  it('reports a code of the last release the build no longer raises, with a record to copy', () => {
    const result = compareCodes({
      version: '8.0.0-rc.3',
      baseline,
      current: new Set(['ORM.KEPT']),
      records: [],
    });
    deepStrictEqual(result.missing, [
      {
        code: 'ORM.GONE',
        packages: ['@prisma/orm-a', '@prisma/orm-b'],
        record: record({ reason: '…' }),
      },
    ]);
  });

  it('accepts a recorded removal, renamed or not', () => {
    const renamed = record({ replacedBy: 'ORM.NEW', reason: 'renamed' });
    const result = compareCodes({
      version: '8.0.0-rc.3',
      baseline,
      current: new Set(['ORM.KEPT', 'ORM.NEW']),
      records: [renamed],
    });
    deepStrictEqual(result, { missing: [], recorded: [renamed], removable: [], problems: [] });
  });

  it('rejects a record for a code the build still raises', () => {
    const result = compareCodes({
      version: '8.0.0-rc.3',
      baseline,
      current: new Set(['ORM.KEPT', 'ORM.GONE']),
      records: [record()],
    });
    deepStrictEqual(result.recorded, []);
    match(result.problems.join('\n'), /ORM\.GONE: .*still raises it/);
  });

  it('rejects a record for a code the last release does not raise', () => {
    const result = compareCodes({
      version: '8.0.0-rc.3',
      baseline,
      current: new Set(['ORM.KEPT', 'ORM.GONE']),
      records: [record({ code: 'ORM.NEVER_RELEASED' })],
    });
    match(result.problems.join('\n'), /ORM\.NEVER_RELEASED: .*8\.0\.0-rc\.3 does not raise it/);
  });

  it('rejects a replacement the build does not raise', () => {
    const result = compareCodes({
      version: '8.0.0-rc.3',
      baseline,
      current: new Set(['ORM.KEPT']),
      records: [record({ replacedBy: 'ORM.TYPO' })],
    });
    match(result.problems.join('\n'), /ORM\.GONE: .*replacedBy ORM\.TYPO/);
  });

  it('rejects two records for one code', () => {
    const result = compareCodes({
      version: '8.0.0-rc.3',
      baseline,
      current: new Set(['ORM.KEPT']),
      records: [record(), record({ reason: 'again' })],
    });
    match(result.problems.join('\n'), /ORM\.GONE: .*more than one record/);
  });

  it('lists a record made against an earlier release as removable, without failing', () => {
    const old = record({ code: 'ORM.LONG_GONE', lastRelease: '8.0.0-rc.2' });
    const result = compareCodes({
      version: '8.0.0-rc.3',
      baseline,
      current: new Set(['ORM.KEPT', 'ORM.GONE']),
      records: [old],
    });
    deepStrictEqual(result, { missing: [], recorded: [], removable: [old], problems: [] });
  });

  it('rejects a record made against a later release', () => {
    const result = compareCodes({
      version: '8.0.0-rc.3',
      baseline,
      current: new Set(['ORM.KEPT']),
      records: [record({ lastRelease: '8.0.0' })],
    });
    match(result.problems.join('\n'), /later than the last release/);
    strictEqual(result.missing.length, 1);
  });
});

describe('the removed-codes record', () => {
  it('needs a code, the release, a replacement or null, and a reason', () => {
    deepStrictEqual(validateRecords('removedCodes', [record()], 'f'), [record()]);
    throws(() => validateRecords('removedCodes', [record({ reason: '…' })], 'f'), RecordsError);
    throws(() => validateRecords('removedCodes', [record({ code: 'gone' })], 'f'), RecordsError);
    throws(() => validateRecords('removedCodes', [record({ replacedBy: '' })], 'f'), RecordsError);
    const { replacedBy: _, ...withoutReplacement } = record();
    throws(() => validateRecords('removedCodes', [withoutReplacement], 'f'), RecordsError);
  });
});

function tarball(files) {
  const source = build(
    Object.fromEntries(Object.entries(files).map(([f, t]) => [`package/${f}`, t])),
  );
  const file = join(folder(), 'package.tgz');
  execFileSync('tar', ['-czf', file, '-C', source, 'package']);
  return readFileSync(file);
}

const integrityOf = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

function registry(bytes, { integrity = integrityOf(bytes), tarballUrl } = {}) {
  const url = tarballUrl ?? 'https://registry.npmjs.org/@prisma/orm-a/-/orm-a-8.0.0-rc.3.tgz';
  return {
    packument: async () => ({ versions: { '8.0.0-rc.3': { dist: { tarball: url, integrity } } } }),
    fetchImpl: async (requested) => {
      strictEqual(requested, url);
      return new Response(bytes);
    },
  };
}

describe('downloadRelease', () => {
  it('unpacks the published files of the release', async () => {
    const bytes = tarball({ 'dist/index.mjs': '"ORM.KEPT"' });
    const dir = join(folder(), 'orm-a');
    strictEqual(await downloadRelease('@prisma/orm-a', '8.0.0-rc.3', dir, registry(bytes)), true);
    deepStrictEqual([...codesInBuild(dir)], ['ORM.KEPT']);
  });

  it('says so when the registry has no such version', async () => {
    const dir = join(folder(), 'orm-a');
    const options = { ...registry(Buffer.from('')), packument: async () => ({ versions: {} }) };
    strictEqual(await downloadRelease('@prisma/orm-a', '8.0.0-rc.3', dir, options), false);
  });

  it('refuses a tarball whose integrity does not match', async () => {
    const bytes = tarball({ 'dist/index.mjs': '"ORM.KEPT"' });
    const dir = join(folder(), 'orm-a');
    const options = registry(bytes, { integrity: integrityOf(Buffer.from('other')) });
    await rejects(downloadRelease('@prisma/orm-a', '8.0.0-rc.3', dir, options), DownloadError);
    strictEqual(existsSync(join(dir, 'package')), false);
  });

  it('refuses a tarball that is not on the registry', async () => {
    const bytes = tarball({ 'dist/index.mjs': '"ORM.KEPT"' });
    const options = registry(bytes, { tarballUrl: 'https://example.com/orm-a.tgz' });
    await rejects(
      downloadRelease('@prisma/orm-a', '8.0.0-rc.3', join(folder(), 'orm-a'), options),
      DownloadError,
    );
  });
});

function output() {
  let text = '';
  return { write: (chunk) => (text += chunk), text: () => text };
}

async function run({ released, current, records = [], onRegistry = Object.keys(released) }) {
  const root = folder();
  const stdout = output();
  const stderr = output();
  const exitCode = await main({
    root,
    env: {},
    stdout,
    stderr,
    findRelease: async () => ({ version: '8.0.0-rc.3', tag: 'v8.0.0-rc.3' }),
    fetchTag: () => {},
    packagesAt: () => Object.keys(released),
    download: async (name, _version, dir) => {
      if (!onRegistry.includes(name)) return false;
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(join(dir, 'dist', 'index.mjs'), released[name]);
      return true;
    },
    currentPackages: () =>
      Object.entries(current).map(([name, text]) => ({
        name,
        dir: build(text === undefined ? {} : { 'dist/index.mjs': text }),
      })),
    readRemovedCodes: () => records,
  });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
}

describe('main', () => {
  it('passes when every code of the last release is still raised', async () => {
    const result = await run({
      released: { '@prisma/orm-a': '"ORM.KEPT" "ORM.MOVED"' },
      current: { '@prisma/orm-a': '"ORM.KEPT"', '@prisma/orm-b': '"ORM.MOVED"' },
    });
    strictEqual(result.exitCode, 0, result.stdout + result.stderr);
    match(result.stdout, /last release 8\.0\.0-rc\.3 raises 2 codes; this build raises 2/);
  });

  it('fails on a code the last release raised and the build does not, printing a record', async () => {
    const result = await run({
      released: { '@prisma/orm-a': '"ORM.KEPT" "ORM.GONE"' },
      current: { '@prisma/orm-a': '"ORM.KEPT"' },
    });
    strictEqual(result.exitCode, 1);
    match(result.stdout, /no longer raised {2}ORM\.GONE \(@prisma\/orm-a\)/);
    match(
      result.stdout,
      /to record it: \{"code":"ORM\.GONE","lastRelease":"8\.0\.0-rc\.3","replacedBy":null,"reason":"…"\}/,
    );
  });

  it('passes on a recorded removal', async () => {
    const result = await run({
      released: { '@prisma/orm-a': '"ORM.KEPT" "ORM.GONE"' },
      current: { '@prisma/orm-a': '"ORM.KEPT"' },
      records: [record()],
    });
    strictEqual(result.exitCode, 0, result.stdout);
    match(result.stdout, /recorded removal {2}ORM\.GONE: nothing raises it any more/);
  });

  it('fails on a stale record', async () => {
    const result = await run({
      released: { '@prisma/orm-a': '"ORM.KEPT" "ORM.GONE"' },
      current: { '@prisma/orm-a': '"ORM.KEPT" "ORM.GONE"' },
      records: [record()],
    });
    strictEqual(result.exitCode, 1);
    match(result.stdout, /problem {2}ORM\.GONE: .*still raises it/);
  });

  it('fails when a released package is missing from the registry', async () => {
    const result = await run({
      released: { '@prisma/orm-a': '"ORM.KEPT"', '@prisma/orm-b': '"ORM.OTHER"' },
      current: { '@prisma/orm-a': '"ORM.KEPT" "ORM.OTHER"' },
      onRegistry: ['@prisma/orm-a'],
    });
    strictEqual(result.exitCode, 1);
    match(result.stdout, /problem {2}@prisma\/orm-b: .*registry has no version 8\.0\.0-rc\.3/);
  });

  it('fails when a package of this build has not been built', async () => {
    const result = await run({
      released: { '@prisma/orm-a': '"ORM.KEPT"' },
      current: { '@prisma/orm-a': '"ORM.KEPT"', '@prisma/orm-b': undefined },
    });
    strictEqual(result.exitCode, 1);
    match(result.stdout, /problem {2}@prisma\/orm-b: .*no dist folder; run pnpm build/);
  });

  it('fails when the last release has no codes at all, which proves the scan found nothing', async () => {
    const result = await run({
      released: { '@prisma/orm-a': 'export {}' },
      current: { '@prisma/orm-a': '"ORM.KEPT"' },
    });
    strictEqual(result.exitCode, 1);
    match(result.stdout, /problem {2}found no error codes in the last release/);
  });

  it('fails on a records file it cannot read', async () => {
    const root = folder();
    const stderr = output();
    const exitCode = await main({
      root,
      env: {},
      stdout: output(),
      stderr,
      readRemovedCodes: () => {
        throw new RecordsError('removed-error-codes.json: record 1: reason must be a text');
      },
    });
    strictEqual(exitCode, 1);
    match(stderr.text(), /reason must be a text/);
  });
});
