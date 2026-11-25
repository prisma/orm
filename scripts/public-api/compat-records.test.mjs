import { deepStrictEqual, match, strictEqual } from 'node:assert/strict';
import { linkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { compareVersions, stampVersion } from './compat.mjs';
import { brokenExports, fixtureCheck, names, workFolder } from './compat-fixture.mjs';

const work = workFolder('api-compat-records-tests');
const check = fixtureCheck(work);

describe('checkPackage with recorded breaks', () => {
  const record = {
    path: '.',
    export: 'format',
    release: '1.0.0',
    reason: 'format accepts only strings now',
  };

  it('passes a recorded break and lists it', () => {
    const result = check('narrowed-parameter', { records: [record] });
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(result.problems, []);
    deepStrictEqual(result.recorded, [
      { path: '.', name: 'format', reason: 'format accepts only strings now' },
    ]);
  });

  it('fails once the recorded break is undone', () => {
    const { problems } = check('unchanged', { records: [record] });
    deepStrictEqual(problems, [
      '. format: the recorded break is no longer a break. Remove the record.',
    ]);
  });

  it('skips a record for an earlier release and lists it as removable', () => {
    const result = check('narrowed-parameter', { records: [{ ...record, release: '1.0.0-rc.3' }] });
    deepStrictEqual(result.problems, []);
    deepStrictEqual(names(result.breaks), ['. format value']);
    deepStrictEqual(result.removable, [{ path: '.', export: 'format', release: '1.0.0-rc.3' }]);
  });

  it('fails on a record for a later release than the last', () => {
    const { problems } = check('narrowed-parameter', {
      records: [{ ...record, release: '1.0.1' }],
    });
    deepStrictEqual(problems, [
      '. format: the recorded break is for release 1.0.1, which is later than the last release, 1.0.0.',
    ]);
  });

  it('fails on a record for an export the release does not have', () => {
    const { problems } = check('unchanged', { records: [{ ...record, export: 'missing' }] });
    deepStrictEqual(problems, [
      '. missing: a break is recorded for an export the last release does not declare in this package. Remove the record.',
    ]);
  });
});

describe('checkPackage on import paths', () => {
  const pathRecord = {
    path: './sub',
    export: '*',
    release: '1.0.0',
    reason: 'the sub path is gone',
  };

  it('fails when an import path is removed', () => {
    deepStrictEqual(brokenExports(check('paths-removed', { release: 'paths-release' })), [
      { path: './sub', name: '*', test: 'path', failsRun: true },
    ]);
  });

  it('passes a removed path that is recorded', () => {
    const result = check('paths-removed', { release: 'paths-release', records: [pathRecord] });
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(result.problems, []);
    deepStrictEqual(result.recorded, [
      { path: './sub', name: '*', reason: 'the sub path is gone' },
    ]);
  });

  it('fails on a recorded path removal once the path is back', () => {
    const { problems } = check('paths-release', {
      release: 'paths-release',
      records: [pathRecord],
    });
    deepStrictEqual(problems, [
      './sub *: the recorded break is no longer a break. Remove the record.',
    ]);
  });

  it('fails, before GA too, when the current build lacks a path its package.json exports', () => {
    const result = check('paths-unbuilt', { release: 'paths-release', strict: false });
    deepStrictEqual(result.breaks, []);
    strictEqual(result.problems.length, 1);
    match(result.problems[0], /^\.\/sub: the current build cannot be imported/);
  });
});

describe('the test that must fail', () => {
  it('fails the run when it is missing', () => {
    const { problems } = check('unchanged', { mustFail: false });
    deepStrictEqual(problems, [
      'the test that must fail passed, so the generated tests were not compiled as expected.',
    ]);
  });
});

describe('stampVersion', () => {
  it('replaces the manifest, so a hard link to it, as in pnpm’s store, keeps the old version', () => {
    const dir = join(work, 'stamp');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"a","version":"1.0.0"}');
    linkSync(join(dir, 'package.json'), join(work, 'store-copy.json'));
    stampVersion(dir);
    strictEqual(
      JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version,
      '1.0.0-last-release',
    );
    strictEqual(JSON.parse(readFileSync(join(work, 'store-copy.json'), 'utf8')).version, '1.0.0');
  });
});

describe('compareVersions', () => {
  it('orders versions as semver does', () => {
    const sorted = ['1.0.0', '1.0.0-rc.10', '0.9.0', '1.0.0-rc.2', '1.0.0-dev.1', '1.1.0'].sort(
      compareVersions,
    );
    deepStrictEqual(sorted, [
      '0.9.0',
      '1.0.0-dev.1',
      '1.0.0-rc.2',
      '1.0.0-rc.10',
      '1.0.0',
      '1.1.0',
    ]);
  });
});
