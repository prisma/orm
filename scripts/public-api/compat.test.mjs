import { deepStrictEqual, match, strictEqual } from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkPackage, isPrerelease, stampVersion } from './compat.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'compat');
// Inside the repository, so that the declarations resolve @types/node through its node_modules.
const work = join(here, '..', '..', 'wip', `api-compat-tests-${process.pid}`);
after(() => rmSync(work, { recursive: true, force: true }));

function check(current, { records = [], version = '1.0.0', strict = true, stamp = true } = {}) {
  const workDir = join(work, `${current}-${Math.random().toString(36).slice(2)}`);
  const releaseDir = join(workDir, 'node_modules', 'release-fixture');
  const currentDir = join(workDir, 'node_modules', 'current-fixture');
  mkdirSync(dirname(releaseDir), { recursive: true });
  cpSync(join(fixtures, 'release'), releaseDir, { recursive: true });
  if (stamp) stampVersion(releaseDir);
  symlinkSync(join(fixtures, current), currentDir);
  return checkPackage({
    name: 'fixture-compat',
    releaseDir,
    currentDir,
    releaseSpecifier: 'release-fixture',
    currentSpecifier: 'current-fixture',
    testFile: join(workDir, 'tests', 'fixture.ts'),
    records,
    version,
    strict,
  });
}

const brokenExports = (result) =>
  result.breaks.map(({ path, name, test, failsRun }) => ({ path, name, test, failsRun }));

describe('checkPackage, with the release treated as GA', () => {
  it('passes an unchanged build, private members and generic types included', () => {
    const result = check('unchanged');
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(result.undecided, []);
    deepStrictEqual(result.problems, []);
    deepStrictEqual(result.counts, {
      paths: 1,
      exports: 8,
      forwarded: 0,
      notCompared: 0,
      tests: 9,
    });
  });

  it('fails when an export is removed', () => {
    deepStrictEqual(brokenExports(check('removed-export')), [
      { path: '.', name: 'version', test: 'value', failsRun: true },
    ]);
  });

  it('fails when a parameter is narrowed', () => {
    deepStrictEqual(brokenExports(check('narrowed-parameter')), [
      { path: '.', name: 'format', test: 'value', failsRun: true },
    ]);
  });

  it('fails when a method parameter is narrowed', () => {
    deepStrictEqual(brokenExports(check('narrowed-method-parameter')), [
      { path: '.', name: 'CacheStore', test: 'type', failsRun: true },
    ]);
  });

  it('passes when an optional parameter is added', () => {
    deepStrictEqual(brokenExports(check('optional-parameter-added')), []);
  });

  it('fails when an interface an exported function accepts gets a new required member', () => {
    deepStrictEqual(brokenExports(check('required-member-on-accepted')), [
      { path: '.', name: 'createMiddleware', test: 'value', failsRun: true },
    ]);
  });

  it('passes when a type that is only returned gets a new required member', () => {
    deepStrictEqual(brokenExports(check('required-member-on-returned')), []);
  });

  it('reports a break in a preview_ export without failing the run', () => {
    deepStrictEqual(brokenExports(check('preview-narrowed')), [
      { path: '.', name: 'preview_format', test: 'value', failsRun: false },
    ]);
  });
});

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

  it('fails on a record for an earlier release', () => {
    const { problems, breaks } = check('narrowed-parameter', {
      records: [{ ...record, release: '0.9.0' }],
    });
    deepStrictEqual(problems, [
      '. format: the recorded break is for release 0.9.0, but the last release is 1.0.0. Remove the record.',
    ]);
    strictEqual(breaks.length, 1);
  });

  it('fails on a record for an export the release does not have', () => {
    const { problems } = check('unchanged', { records: [{ ...record, export: 'missing' }] });
    deepStrictEqual(problems, [
      '. missing: a break is recorded for an export the last release does not declare in this package. Remove the record.',
    ]);
  });
});

describe('checkPackage before a GA release', () => {
  it('reports the same break without failing the run', () => {
    const result = check('narrowed-parameter', { version: '1.0.0-rc.1', strict: false });
    deepStrictEqual(brokenExports(result), [
      { path: '.', name: 'format', test: 'value', failsRun: false },
    ]);
    deepStrictEqual(result.problems, []);
  });
});

describe('two copies with one name and version', () => {
  it('are still compared once the release copy is stamped', () => {
    strictEqual(
      JSON.parse(readFileSync(join(fixtures, 'removed-export', 'package.json'), 'utf8')).version,
      JSON.parse(readFileSync(join(fixtures, 'release', 'package.json'), 'utf8')).version,
    );
    deepStrictEqual(brokenExports(check('removed-export')), [
      { path: '.', name: 'version', test: 'value', failsRun: true },
    ]);
  });

  it('fail the run when they are not stamped, because TypeScript reads them as one', () => {
    const { breaks, problems } = check('removed-export', { stamp: false });
    deepStrictEqual(breaks, []);
    strictEqual(problems.length, 1);
    match(problems[0], /read the last release and the current build as one package/);
  });
});

describe('isPrerelease', () => {
  it('is true only for a version with a pre-release part', () => {
    deepStrictEqual(
      ['8.0.0-rc.25', '8.0.0', '8.1.2+build.1', '8.0.0-dev.3+abc'].map(isPrerelease),
      [true, false, false, true],
    );
  });
});
