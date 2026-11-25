import { deepStrictEqual, match, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { isPrerelease } from './compat.mjs';
import { brokenExports, fixtureCheck, fixtures, names, workFolder } from './compat-fixture.mjs';

const check = fixtureCheck(workFolder('api-compat-tests'));
const forwardDependency = [{ folder: 'fwd-dep', name: 'fixture-fwd-dep' }];

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

  it('fails when a class is made abstract', () => {
    deepStrictEqual(brokenExports(check('class-made-abstract')), [
      { path: '.', name: 'Client', test: 'value', failsRun: true },
    ]);
  });

  it('reports a break in a preview_ export without failing the run', () => {
    deepStrictEqual(brokenExports(check('preview-narrowed')), [
      { path: '.', name: 'preview_format', test: 'value', failsRun: false },
    ]);
  });
});

describe('checkPackage on names a path forwards from another package', () => {
  it('checks only that they still exist', () => {
    const result = check('forward-release', {
      release: 'forward-release',
      dependencies: forwardDependency,
    });
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(result.problems, []);
    strictEqual(result.counts.forwarded, 2);
  });

  it('fails when one is no longer forwarded', () => {
    const result = check('forward-removed', {
      release: 'forward-release',
      dependencies: forwardDependency,
    });
    deepStrictEqual(brokenExports(result), [
      { path: '.', name: 'fwdFn', test: 'exists', failsRun: true },
      { path: '.', name: 'Fwd', test: 'exists', failsRun: true },
    ]);
  });
});

describe('checkPackage on types too deep to compare', () => {
  it('compares each export on its own once one is too deep, so none passes on the type left behind', () => {
    const { breaks, undecided } = check('json-widened', { release: 'json-release' });
    deepStrictEqual(names([...breaks, ...undecided]).sort(), [
      '. JsonObject type',
      '. JsonValue type',
      '. Row type',
      '. g value',
    ]);
  });

  it('reports a break that sits beside a comparison too deep to finish', () => {
    const { breaks } = check('row-changed', { release: 'row-release' });
    deepStrictEqual(names(breaks), ['. Row type']);
  });
});

describe('checkPackage on what it cannot compare', () => {
  it('fails when the release imports a module that is not installed', () => {
    const { problems } = check('unresolved-narrowed', { release: 'unresolved-release' });
    strictEqual(problems.length, 1);
    match(problems[0], /not-installed-anywhere/);
  });

  it('lists a test whose release side is never or any as not compared', () => {
    const result = check('paths-release', { release: 'paths-release' });
    deepStrictEqual(names(result.notCompared), ['. OnlyStrings type']);
    strictEqual(result.counts.notCompared, 1);
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
    match(
      problems[0],
      /read two copies of fixture-compat, the last release's and the current build's, as one package/,
    );
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
