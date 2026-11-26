import { deepStrictEqual, match, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
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

  it('passes when an optional parameter is added, having compared it', () => {
    const result = check('optional-parameter-added');
    deepStrictEqual(
      [brokenExports(result), result.problems, result.undecided, result.notCompared],
      [[], [], [], []],
    );
  });

  it('keeps overloads together that another member separates', () => {
    deepStrictEqual(
      brokenExports(check('overloads-release', { release: 'overloads-release' })),
      [],
    );
    deepStrictEqual(brokenExports(check('overloads-narrowed', { release: 'overloads-release' })), [
      { path: '.', name: 'Reader', test: 'type', failsRun: true },
    ]);
  });

  it('lists two private classes with one name, which nothing stable tells apart, as not compared', () => {
    const result = check('tokens-swapped', { release: 'tokens-release' });
    deepStrictEqual(
      names(result.notCompared).filter((each) => each.includes('Token')),
      ['* private class fixture-compat:Token private class'],
    );
  });

  it('fails when an abstract class gains an abstract member a subclass must implement', () => {
    deepStrictEqual(
      brokenExports(check('abstract-added', { release: 'protected-release' })).filter(
        (each) => each.test === 'abstract',
      ),
      [{ path: '.', name: 'Store', test: 'abstract', failsRun: true }],
    );
    deepStrictEqual(
      brokenExports(check('protected-release', { release: 'protected-release' })),
      [],
    );
  });

  it('subclasses an unchanged abstract class whatever its members and type parameters are', () => {
    const result = check('abstract-generic', { release: 'abstract-generic' });
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(result.problems, []);
  });

  it('subclasses an abstract class keyed by a well-known symbol, and lists one keyed by its own symbol as not compared', () => {
    const result = check('abstract-symbols', { release: 'abstract-symbols' });
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(
      result.notCompared.map(({ name, test }) => ({ name, test })),
      [{ name: 'OwnSymbol', test: 'abstract' }],
    );
  });

  it('fails when an abstract class with a protected constructor gains an abstract member', () => {
    deepStrictEqual(
      brokenExports(check('abstract-protected-added', { release: 'abstract-protected-release' })),
      [{ path: '.', name: 'Command', test: 'abstract', failsRun: true }],
    );
    deepStrictEqual(
      brokenExports(check('abstract-protected-release', { release: 'abstract-protected-release' })),
      [],
    );
  });

  it('leaves undecided an export that reaches two private classes with one name, and decides the rest', () => {
    const result = check('tokens-swapped', { release: 'tokens-release' });
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(
      result.undecided.map(({ name, test }) => `${name} ${test}`),
      ['make value', 'use value'],
    );
    match(result.undecided[0].message, /private class fixture-compat:Token/);
    strictEqual(result.undecided[0].stage, 'shared marker');
    deepStrictEqual(
      names(result.notCompared).filter((each) => each.includes('Gone')),
      ['. Gone type'],
    );
  });

  it('subclasses an abstract class with a protected member keyed by a well-known symbol', () => {
    const result = check('abstract-protected-symbol', { release: 'abstract-protected-symbol' });
    deepStrictEqual([brokenExports(result), result.notCompared], [[], []]);
  });

  it('leaves undecided an export that reaches two static unique symbols with one name', () => {
    const result = check('static-symbol-swapped', { release: 'static-symbol-release' });
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(
      result.undecided.map(({ name, test }) => `${name} ${test}`),
      ['keyed value'],
    );
  });

  it('leaves undecided an export that reaches two static unique symbols with a quoted or numeric name', () => {
    const result = check('quoted-symbol-swapped', { release: 'quoted-symbol-release' });
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(
      result.undecided.map(({ name, test }) => `${name} ${test}`),
      ['indexed value', 'keyed value', 'numbered value', 'quoted value'],
    );
  });

  it('fails when a value whose comparison is undecided is made type-only', () => {
    for (const [current, release] of [
      ['generic-typeonly', 'generic'],
      ['shape-value-typeonly', 'shape-value-release'],
    ]) {
      const result = check(current, { release });
      deepStrictEqual(result.undecided, []);
      deepStrictEqual(result.decidedByMembers, []);
      deepStrictEqual(
        brokenExports(result).filter((each) => each.test === 'value'),
        [
          {
            path: '.',
            name: current === 'generic-typeonly' ? 'required' : 'shape',
            test: 'value',
            failsRun: true,
          },
        ],
      );
    }
  });

  it('leaves the existence test of a forwarded name decided, and lists a shared marker only in the package that declares it', () => {
    const result = check('marker-forward', {
      release: 'marker-forward',
      dependencies: [{ folder: 'marker-dep', name: 'fixture-marker-dep' }],
      own: ['fixture-marker-dep'],
    });
    deepStrictEqual(
      result.undecided.map(({ name, test }) => `${name} ${test}`),
      ['hold value'],
    );
    deepStrictEqual(result.notCompared, []);
  });

  it('names a static unique symbol of an anonymous class the same way when rewriting and when finding collisions', () => {
    const result = check('anonymous-symbol-swapped', { release: 'anonymous-symbol-release' });
    deepStrictEqual(names(result.notCompared), [
      '* unique symbol fixture-compat:default.id unique symbol',
    ]);
    deepStrictEqual(
      result.undecided.map(({ name, test }) => `${name} ${test}`),
      ['keyed value'],
    );
  });

  it('takes an export decided member by member off that list when it reaches a shared marker', () => {
    const result = check('shape-marker', { release: 'shape-marker' });
    deepStrictEqual(result.decidedByMembers, []);
    deepStrictEqual(
      result.undecided.map(({ name, test, stage }) => `${name} ${test} ${stage}`),
      [
        'Holder type shared marker',
        'Holder value shared marker',
        'Holder constructor shared marker',
      ],
    );
  });

  it('compares a class with a protected static unique symbol', () => {
    const result = check('protected-static-symbol', { release: 'protected-static-symbol' });
    deepStrictEqual([brokenExports(result), result.undecided, result.problems], [[], [], []]);
  });

  it('leaves undecided an export that reaches a class whose static unique symbols share a marker, whatever their name form', () => {
    const result = check('keys-class-swapped', { release: 'keys-class-release' });
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(
      result.undecided.map(({ name, test }) => `${name} ${test}`),
      ['computed value', 'keys value', 'numbered value'],
    );
  });

  it('fails when the release imports a file of its own that is missing', () => {
    const { problems } = check('relative-release', { release: 'relative-missing' });
    strictEqual(problems.length, 1);
    match(problems[0], /\.\/shape\.mjs/);
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
    deepStrictEqual(result.decidedByMembers, []);
  });

  it('gives two unique symbols with one name in one package one name, and lists them as not compared', () => {
    for (const current of ['symbols-release', 'symbols-changed']) {
      const result = check(current, { release: 'symbols-release' });
      deepStrictEqual(brokenExports(result), []);
      deepStrictEqual(names(result.notCompared), [
        '* unique symbol fixture-compat:brand unique symbol',
      ]);
      deepStrictEqual(
        result.undecided.map(({ name, test }) => `${name} ${test}`),
        ['Both type'],
      );
    }
  });

  it('finds no two classes or unique symbols with one name in a declaration file no entry point reaches', () => {
    const result = check('orphan-chunk', { release: 'orphan-chunk' });
    deepStrictEqual([brokenExports(result), result.undecided, result.notCompared], [[], [], []]);
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
    deepStrictEqual(result.decidedByMembers, []);
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

  it('fails when a class or a function is made type-only', () => {
    deepStrictEqual(brokenExports(check('class-type-only')), [
      { path: '.', name: 'Client', test: 'value', failsRun: true },
    ]);
    deepStrictEqual(brokenExports(check('function-type-only')), [
      { path: '.', name: 'format', test: 'value', failsRun: true },
    ]);
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

describe('checkPackage on a prefixed name the release also exports under an unprefixed one', () => {
  let result;
  const removed = (name) => {
    result ??= check('promoted-removed', { release: 'promoted-release' });
    return brokenExports(result).filter((each) => each.name === name);
  };

  it('fails the run when a renamed export is removed', () => {
    deepStrictEqual(removed('ea_renamed'), [
      { path: '.', name: 'ea_renamed', test: 'value', failsRun: true },
    ]);
  });

  it('fails the run when a constant typed as the unprefixed value is removed', () => {
    deepStrictEqual(removed('ea_assigned'), [
      { path: '.', name: 'ea_assigned', test: 'value', failsRun: true },
    ]);
  });

  it('fails the run when a type alias of the unprefixed type is removed', () => {
    deepStrictEqual(
      [...removed('ea_Box'), ...removed('ea_Shape')],
      [
        { path: '.', name: 'ea_Box', test: 'type', failsRun: true },
        { path: '.', name: 'ea_Shape', test: 'type', failsRun: true },
      ],
    );
  });

  it('fails the run through a chain of prefixed names', () => {
    deepStrictEqual(removed('ea_chained'), [
      { path: '.', name: 'ea_chained', test: 'value', failsRun: true },
    ]);
  });

  it('reports only a prefixed name whose group has no unprefixed name', () => {
    deepStrictEqual(removed('ea_early'), [
      { path: '.', name: 'ea_early', test: 'value', failsRun: false },
    ]);
  });

  it('reports only a prefixed declaration of its own beside an unprefixed one of that name', () => {
    deepStrictEqual(removed('ea_createClient'), [
      { path: '.', name: 'ea_createClient', test: 'value', failsRun: false },
    ]);
  });

  it('reports only a type alias that does not pass its type arguments through', () => {
    deepStrictEqual(removed('ea_Fixed'), [
      { path: '.', name: 'ea_Fixed', test: 'type', failsRun: false },
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

  it('uses a name forwarded with export type * only as a type', () => {
    const result = check('star-type-only', {
      release: 'star-type-only',
      dependencies: forwardDependency,
    });
    deepStrictEqual([brokenExports(result), result.problems], [[], []]);
  });

  it('keeps a class forwarded by both a star and a type-only star a value, and fails when only the type-only star is left', () => {
    const result = check('star-type-only', {
      release: 'star-both-release',
      dependencies: forwardDependency,
    });
    deepStrictEqual(
      brokenExports(result).filter((each) => each.name === 'Klass'),
      [{ path: '.', name: 'Klass', test: 'exists', failsRun: true }],
    );
  });

  it('fails when a forwarded class becomes a forwarded function', () => {
    const result = check('forward-class-function', {
      release: 'forward-class-release',
      dependencies: [...forwardDependency, { folder: 'fwd-other', name: 'fixture-fwd-other' }],
    });
    deepStrictEqual(brokenExports(result), [
      { path: '.', name: 'Klass', test: 'exists', failsRun: true },
    ]);
  });

  it('fails when a forwarded value is made type-only', () => {
    const result = check('forward-type-only', {
      release: 'forward-release',
      dependencies: forwardDependency,
    });
    deepStrictEqual(brokenExports(result), [
      { path: '.', name: 'fwdFn', test: 'exists', failsRun: true },
    ]);
  });

  it('checks that a value the release forwards type-only is still forwarded', () => {
    const result = check('forward-removed', {
      release: 'forward-type-only',
      dependencies: forwardDependency,
    });
    deepStrictEqual(brokenExports(result), [
      { path: '.', name: 'fwdFn', test: 'exists', failsRun: true },
      { path: '.', name: 'Fwd', test: 'exists', failsRun: true },
    ]);
    deepStrictEqual(result.notCompared, []);
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

  it('checks the imports even when the first comparison overflows the stack', () => {
    const { problems, undecided } = check('overflow-unresolved', {
      release: 'overflow-unresolved',
    });
    deepStrictEqual(
      undecided.map(({ name, message }) => ({ name, message })),
      [{ name: 'Above', message: 'not decided: TypeScript ran out of stack comparing it' }],
    );
    deepStrictEqual(problems.length, 1);
    match(problems[0], /not-installed-anywhere/);
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
    deepStrictEqual(result.decidedByMembers, []);
  });
});

describe('checkPackage on members added to another package with declare module', () => {
  const registry = (side) => ({ side, folder: 'registry', name: 'fixture-registry' });
  const options = {
    release: 'augment-release',
    installed: [registry('release'), registry('current')],
    own: ['fixture-registry'],
  };

  it('passes an unchanged augmentation', () => {
    const result = check('augment-release', options);
    deepStrictEqual(brokenExports(result), []);
    deepStrictEqual(result.problems, []);
    deepStrictEqual(result.undecided, []);
  });

  it('fails when the augmentation is removed', () => {
    deepStrictEqual(brokenExports(check('augment-removed', options)), [
      {
        path: '.',
        name: 'augments fixture-registry interface Registry',
        test: 'augments',
        failsRun: true,
      },
    ]);
  });

  it('fails when an added member is narrowed', () => {
    deepStrictEqual(
      brokenExports(check('augment-narrowed', options)).filter((each) => each.test === 'augments'),
      [
        {
          path: '.',
          name: 'augments fixture-registry interface Registry',
          test: 'augments',
          failsRun: true,
        },
      ],
    );
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

  it('lists a value typed any once as not compared, though both its comparison and its use are', () => {
    const result = check('any-value-release', { release: 'any-value-release' });
    deepStrictEqual(names(result.notCompared), ['. x value']);
    deepStrictEqual(result.breaks, []);
  });

  it('reports a value typed any that is made type-only as a break, and not also as not compared', () => {
    const result = check('any-value-typeonly', { release: 'any-value-release' });
    deepStrictEqual(brokenExports(result), [
      { path: '.', name: 'x', test: 'value', failsRun: true },
    ]);
    deepStrictEqual(result.notCompared, []);
    strictEqual(result.counts.notCompared, 0);
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
