import { deepStrictEqual, match, strictEqual } from 'node:assert/strict';
import { linkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { brokenExports, fixtureCheck, names, workFolder } from './compat-fixture.mjs';
import { stampVersion } from './compat-install.mjs';

const work = workFolder('api-compat-records-tests');
const check = fixtureCheck(work);

const messageOf = (current, options, name) =>
  check(current, options).breaks.find((each) => each.name === name).message;

describe('checkPackage with recorded breaks', () => {
  const record = {
    path: '.',
    export: 'format',
    test: 'value',
    lastRelease: '1.0.0',
    message: messageOf('narrowed-parameter', {}, 'format'),
    reason: 'format accepts only strings now',
  };

  it('passes a recorded break and lists it', () => {
    const result = check('narrowed-parameter', { records: [record] });
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(result.problems, []);
    deepStrictEqual(result.recorded, [
      { path: '.', name: 'format', test: 'value', reason: 'format accepts only strings now' },
    ]);
  });

  it('fails once the recorded break is undone', () => {
    const { problems } = check('unchanged', { records: [record] });
    deepStrictEqual(problems, [
      '. format (value): the record matches no break. Remove it, or correct its message.',
    ]);
  });

  it('does not cover a break of the same test with another message', () => {
    const result = check('narrowed-parameter', {
      records: [{ ...record, message: 'Type something else.' }],
    });
    deepStrictEqual(names(result.breaks), ['. format value']);
    deepStrictEqual(result.problems, [
      '. format (value): the record matches no break. Remove it, or correct its message.',
    ]);
  });

  it('skips a record for an earlier release and lists it as removable', () => {
    const stale = { ...record, lastRelease: '1.0.0-rc.3' };
    const result = check('narrowed-parameter', { records: [stale] });
    deepStrictEqual(result.problems, []);
    deepStrictEqual(names(result.breaks), ['. format value']);
    deepStrictEqual(result.removable, [stale]);
  });

  it('fails on a record for a later release than the last', () => {
    const { problems } = check('narrowed-parameter', {
      records: [{ ...record, lastRelease: '1.0.1' }],
    });
    deepStrictEqual(problems, [
      '. format (value): the record is for the last release 1.0.1, which is later than the last release, 1.0.0.',
    ]);
  });

  it('fails on a record for an export the release does not have', () => {
    const { problems } = check('unchanged', { records: [{ ...record, export: 'missing' }] });
    deepStrictEqual(problems, [
      '. missing: a break is recorded for an export the last release does not declare in this package. Remove the record.',
    ]);
  });
});

describe('checkPackage with a recorded break of one test', () => {
  it('still reports the breaks of the export’s other tests', () => {
    const options = { release: 'record-release' };
    const result = check('record-changed', {
      ...options,
      records: [
        {
          path: '.',
          export: 'Client',
          test: 'constructor',
          lastRelease: '1.0.0',
          message: check('record-changed', options).breaks.find(
            (each) => each.test === 'constructor',
          ).message,
          reason: 'the constructor takes strings only',
        },
      ],
    });
    deepStrictEqual(brokenExports(result), [
      { path: '.', name: 'Client', test: 'type', failsRun: true },
      { path: '.', name: 'Client', test: 'value', failsRun: true },
    ]);
    deepStrictEqual(result.problems, []);
  });

  it('still reports a later break of the same test, whose message differs', () => {
    const message = messageOf('narrowed-method-parameter', {}, 'CacheStore');
    const result = check('narrowed-method-parameter-other', {
      records: [
        {
          path: '.',
          export: 'CacheStore',
          test: 'type',
          lastRelease: '1.0.0',
          message,
          reason: 'narrowed',
        },
      ],
    });
    deepStrictEqual(names(result.breaks), ['. CacheStore type']);
  });

  it('fails on a record for a test the export does not have', () => {
    const { problems } = check('narrowed-parameter', {
      records: [
        {
          path: '.',
          export: 'format',
          test: 'type',
          lastRelease: '1.0.0',
          message: 'x',
          reason: 'narrowed',
        },
      ],
    });
    deepStrictEqual(problems, [
      '. format: a break is recorded for its type test, which this export does not have. Remove the record or correct its test.',
      '. format (type): the record matches no break. Remove it, or correct its message.',
    ]);
  });
});

describe('checkPackage on import paths', () => {
  const pathRecord = {
    path: './sub',
    export: '*',
    test: 'path',
    lastRelease: '1.0.0',
    message: messageOf('paths-removed', { release: 'paths-release' }, '*'),
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
      { path: './sub', name: '*', test: 'path', reason: 'the sub path is gone' },
    ]);
  });

  it('fails on a recorded path removal once the path is back', () => {
    const { problems } = check('paths-release', {
      release: 'paths-release',
      records: [pathRecord],
    });
    deepStrictEqual(problems, [
      './sub * (path): the record matches no break. Remove it, or correct its message.',
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
