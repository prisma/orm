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
      tests: 10,
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

  it('fails when a constructor parameter is narrowed', () => {
    deepStrictEqual(
      brokenExports(check('constructor-narrowed', { release: 'constructor-release' })),
      [{ path: '.', name: 'Client', test: 'constructor', failsRun: true }],
    );
  });

  it('passes a class whose private members changed, in TypeScript’s own comparison', () => {
    const result = check('private-changed');
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(result.undecided, []);
    deepStrictEqual(result.fallbacks, []);
  });

  it('tells apart two unique symbols with one name in two modules', () => {
    deepStrictEqual(brokenExports(check('symbols-release', { release: 'symbols-release' })), []);
    deepStrictEqual(brokenExports(check('symbols-changed', { release: 'symbols-release' })), [
      { path: '.', name: 'Both', test: 'type', failsRun: true },
    ]);
  });

  it('reports a generic signature TypeScript cannot relate between two copies as undecided, not as a break', () => {
    const result = check('generic', { release: 'generic' });
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(result.problems, []);
    deepStrictEqual(
      result.undecided.map(({ name, test, stage }) => ({ name, test, stage })),
      [{ name: 'required', test: 'value', stage: 'structural' }],
    );
  });

  it('does not pass a change in a generic signature TypeScript cannot relate between two copies', () => {
    const result = check('generic-changed', { release: 'generic' });
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(names(result.undecided), ['. required value']);
    deepStrictEqual(result.fallbacks, []);
  });

  it('fails when a generic function returns a wider type, which only the comparison with the twin can tell', () => {
    const result = check('pick-widened', { release: 'pick-release' });
    deepStrictEqual(brokenExports(result), [
      { path: '.', name: 'pick', test: 'value', failsRun: true },
    ]);
    deepStrictEqual(result.undecided, []);
  });

  it('compares a type member by member when TypeScript cannot relate it whole between two copies', () => {
    const result = check('members-changed', { release: 'members-release' });
    deepStrictEqual(brokenExports(result), [
      { path: '.', name: 'Shape', test: 'type', failsRun: true },
    ]);
    match(result.breaks[0].message, /^pick: /);
  });

  it('fails on a change the structural comparison of the whole type sees, before comparing its members', () => {
    deepStrictEqual(brokenExports(check('callable-changed', { release: 'callable-release' })), [
      { path: '.', name: 'Format', test: 'type', failsRun: true },
    ]);
  });

  it('reports a type with a member TypeScript cannot relate between two copies as undecided at the structural stage', () => {
    const result = check('members-release', { release: 'members-release' });
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(
      result.undecided.map(({ name, test, stage }) => ({ name, test, stage })),
      [{ name: 'Shape', test: 'type', stage: 'structural' }],
    );
    match(result.undecided[0].message, /^not decided for required: /);
  });

  it('fails when a protected method parameter is narrowed', () => {
    deepStrictEqual(brokenExports(check('protected-narrowed', { release: 'protected-release' })), [
      { path: '.', name: 'Store', test: 'type', failsRun: true },
      { path: '.', name: 'Store', test: 'value', failsRun: true },
    ]);
  });

  it('fails when an abstract method a subclass implements takes a wider parameter', () => {
    deepStrictEqual(brokenExports(check('abstract-widened', { release: 'protected-release' })), [
      { path: '.', name: 'Store', test: 'abstract', failsRun: true },
    ]);
  });

  it('passes a unique symbol that moved to another declaration file', () => {
    deepStrictEqual(brokenExports(check('symbol-moved', { release: 'symbol-moved-release' })), []);
  });

  it('fails when a parameter takes another class whose members are all private', () => {
    deepStrictEqual(brokenExports(check('opaque-release', { release: 'opaque-release' })), []);
    deepStrictEqual(brokenExports(check('opaque-swapped', { release: 'opaque-release' })), [
      { path: '.', name: 'open', test: 'value', failsRun: true },
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

  it('reports a failure it has no time to confirm as a break, and says so', () => {
    const { breaks, undecided } = check('json-widened', { release: 'json-release', budgetMs: 0 });
    deepStrictEqual(undecided, []);
    deepStrictEqual(names(breaks).sort(), [
      '. JsonObject type',
      '. JsonValue type',
      '. Row type',
      '. g value',
    ]);
    match(
      breaks.at(-1).message,
      /not confirmed against the copy of the last release: the time ran out/,
    );
  });

  it('reports a comparison too deep to finish as undecided, and compares the rest again', () => {
    const { breaks, undecided } = check('deep', { release: 'deep' });
    deepStrictEqual(breaks, []);
    deepStrictEqual(names(undecided), ['. Big type']);
  });

  it('reports the tests after one too deep as undecided when there is no time to compare them again', () => {
    const { undecided } = check('deep', { release: 'deep', budgetMs: 0 });
    deepStrictEqual(names(undecided), ['. Big type', '. Holder type']);
    match(undecided.at(-1).message, /the time for comparing it again ran out/);
  });

  it('reports a comparison that overflows the stack as undecided, and decides the rest', () => {
    const { breaks, undecided } = check('overflow', { release: 'overflow' });
    deepStrictEqual(breaks, []);
    deepStrictEqual(
      undecided.map(({ name, test, message }) => ({ name, test, message })),
      [
        {
          name: 'Tall',
          test: 'type',
          message: 'not decided: TypeScript ran out of stack comparing it',
        },
      ],
    );
  });

  it('reports a break that sits beside a comparison too deep to finish', () => {
    const { breaks } = check('row-changed', { release: 'row-release' });
    deepStrictEqual(names(breaks), ['. Row type']);
  });
});

describe('checkPackage on third-party packages', () => {
  it('reads one copy of a third-party version that is installed twice, with different peers', () => {
    const copy = (side) => ({ side, folder: 'third-party', name: 'fixture-third-party' });
    const result = check('third-party-user', {
      release: 'third-party-user',
      installed: [
        copy('release'),
        copy('current'),
        { side: 'current', folder: 'third-party-peer', name: 'fixture-peer' },
      ],
    });
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(result.fallbacks, []);
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
