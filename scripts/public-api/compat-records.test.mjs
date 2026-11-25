import { deepStrictEqual, match, strictEqual } from 'node:assert/strict';
import { linkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { brokenExports, fixtureCheck, fixtures, names, workFolder } from './compat-fixture.mjs';
import { stampVersion } from './compat-install.mjs';
import { apiFingerprint } from './records.mjs';

const work = workFolder('api-compat-records-tests');
const check = fixtureCheck(work);

const fingerprint = (fixture, path, name) =>
  apiFingerprint(readFileSync(join(fixtures, fixture, 'api.txt'), 'utf8'), path, name);

const recordFor = (fixture, fields) => ({
  path: '.',
  kind: 'break',
  lastRelease: '1.0.0',
  reason: 'on purpose',
  ...fields,
  fingerprint: fingerprint(fixture, fields.path ?? '.', fields.export),
});

describe('checkPackage with recorded breaks', () => {
  const record = recordFor('narrowed-parameter', {
    export: 'format',
    test: 'value',
    reason: 'format accepts only strings now',
  });

  it('passes a recorded break and lists it with its kind', () => {
    const result = check('narrowed-parameter', { records: [record] });
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(result.problems, []);
    deepStrictEqual(result.recorded, [
      {
        path: '.',
        name: 'format',
        test: 'value',
        kind: 'break',
        reason: 'format accepts only strings now',
      },
    ]);
  });

  it('lists an allowed change as one', () => {
    const result = check('narrowed-parameter', { records: [{ ...record, kind: 'allowed' }] });
    deepStrictEqual(
      result.recorded.map(({ kind }) => kind),
      ['allowed'],
    );
  });

  it('prints for an unrecorded break the record that covers it', () => {
    const [unrecorded] = check('narrowed-parameter').breaks;
    deepStrictEqual(unrecorded.record, {
      path: '.',
      export: 'format',
      test: 'value',
      kind: 'break',
      lastRelease: '1.0.0',
      fingerprint: fingerprint('narrowed-parameter', '.', 'format'),
      reason: '…',
    });
    const pasted = check('narrowed-parameter', {
      records: [{ ...unrecorded.record, reason: 'format accepts only strings now' }],
    });
    deepStrictEqual(brokenExports(pasted), []);
    deepStrictEqual(pasted.problems, []);
  });

  it('fails once the recorded break is undone', () => {
    const { problems } = check('unchanged', { records: [record] });
    deepStrictEqual(problems, [
      '. format (value): the recorded break is no longer a break. Remove the record.',
    ]);
  });

  it('judges a recorded export again once its lines in api.txt change, reporting the break with why', () => {
    const result = check('narrowed-parameter-again', { records: [record], strict: false });
    deepStrictEqual(brokenExports(result), [
      { path: '.', name: 'format', test: 'value', failsRun: false },
    ]);
    match(result.breaks[0].note, /^a record for an earlier state of this export exists/);
    deepStrictEqual(result.problems, []);
  });

  for (const [what, fixture] of [
    ['exported', 'configure'],
    ['not exported', 'hidden'],
  ]) {
    it(`judges a recorded export again once a type it names, ${what}, changes`, () => {
      const options = { release: `${fixture}-release` };
      const [recorded] = check(`${fixture}-narrowed`, options).breaks;
      const accepted = { ...recorded.record, reason: 'mode takes only "x" now' };
      deepStrictEqual(
        brokenExports(check(`${fixture}-narrowed`, { ...options, records: [accepted] })),
        [],
      );
      deepStrictEqual(
        names(check(`${fixture}-grown`, { ...options, records: [accepted] }).breaks),
        ['. configure value'],
      );
    });
  }

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
    const result = check('record-changed', {
      release: 'record-release',
      records: [recordFor('record-changed', { export: 'Client', test: 'constructor' })],
    });
    deepStrictEqual(brokenExports(result), [
      { path: '.', name: 'Client', test: 'type', failsRun: true },
      { path: '.', name: 'Client', test: 'value', failsRun: true },
    ]);
    deepStrictEqual(result.problems, []);
  });

  it('still reports a later break of the same test, however TypeScript words it', () => {
    const record = recordFor('narrowed-method-parameter', { export: 'CacheStore', test: 'type' });
    deepStrictEqual(brokenExports(check('narrowed-method-parameter', { records: [record] })), []);
    const result = check('narrowed-method-parameter-other', { records: [record] });
    deepStrictEqual(names(result.breaks), ['. CacheStore type']);
  });

  it('fails on a record for a test the export does not have', () => {
    const { problems } = check('narrowed-parameter', {
      records: [recordFor('narrowed-parameter', { export: 'format', test: 'type' })],
    });
    deepStrictEqual(problems, [
      '. format: a break is recorded for its type test, which this export does not have. Remove the record or correct its test.',
      '. format (type): the recorded break is no longer a break. Remove the record.',
    ]);
  });
});

describe('checkPackage on import paths', () => {
  const pathRecord = {
    path: './sub',
    export: '*',
    test: 'path',
    kind: 'break',
    lastRelease: '1.0.0',
    fingerprint: fingerprint('paths-removed', './sub', '*'),
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
      { path: './sub', name: '*', test: 'path', kind: 'break', reason: 'the sub path is gone' },
    ]);
  });

  it('fails on a recorded path removal once the path is back', () => {
    const { problems } = check('paths-release', {
      release: 'paths-release',
      records: [pathRecord],
    });
    deepStrictEqual(problems, [
      './sub * (path): the recorded break is no longer a break. Remove the record.',
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
