import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyPackage, NODE_ENGINES_RANGE, runCheck } from './validate-node-engines.mjs';

const CONFORMING_PKG = { name: '@prisma/orm-example', engines: { node: NODE_ENGINES_RANGE } };

describe('NODE_ENGINES_RANGE', () => {
  it('is the range every Prisma 8 tool supports', () => {
    strictEqual(NODE_ENGINES_RANGE, '^22.18.0 || ^24.11.0 || >=26.0.0');
  });
});

describe('classifyPackage', () => {
  it('accepts a package that declares the range', () => {
    strictEqual(classifyPackage(CONFORMING_PKG, { publishable: true }), null);
  });

  it('flags a publishable package without engines.node', () => {
    deepStrictEqual(classifyPackage({ name: '@prisma/orm-example' }, { publishable: true }), {
      name: '@prisma/orm-example',
      node: undefined,
      reason: 'missing',
    });
  });

  it('accepts an unpublished package without engines.node', () => {
    strictEqual(classifyPackage({ name: '@repo/tsconfig' }, { publishable: false }), null);
  });

  it('flags an unpublished package that declares a different range', () => {
    deepStrictEqual(
      classifyPackage(
        { name: '@internal/example', engines: { node: '>=24' } },
        { publishable: false },
      ),
      { name: '@internal/example', node: '>=24', reason: 'wrong-range' },
    );
  });

  it('falls back to "<unnamed>" when name is missing', () => {
    strictEqual(classifyPackage({}, { publishable: true })?.name, '<unnamed>');
  });
});

describe('runCheck', () => {
  function makeIo(packages) {
    const stdout = [];
    const stderr = [];
    const io = {
      listPackages: () => packages.map(({ dir, publishable }) => ({ dir, publishable })),
      readPackageJson: (dir) => packages.find((p) => p.dir === dir).manifest,
      stdoutWrite: (s) => stdout.push(s),
      stderrWrite: (s) => stderr.push(s),
    };
    return { io, stdout, stderr };
  }

  it('returns 0 when every package conforms', () => {
    const { io } = makeIo([
      { dir: 'packages/a', publishable: true, manifest: CONFORMING_PKG },
      { dir: 'packages/b', publishable: false, manifest: { name: '@repo/tsconfig' } },
    ]);
    strictEqual(runCheck({ argv: [], io }), 0);
  });

  it('returns 1 and names every offender with the expected range', () => {
    const { io, stderr } = makeIo([
      { dir: 'packages/a', publishable: true, manifest: { name: '@prisma/orm-a' } },
      {
        dir: 'packages/b',
        publishable: false,
        manifest: { name: '@internal/b', engines: { node: '>=24' } },
      },
    ]);
    strictEqual(runCheck({ argv: [], io }), 1);
    const output = stderr.join('');
    strictEqual(output.includes('@prisma/orm-a'), true);
    strictEqual(output.includes('no "engines.node"'), true);
    strictEqual(output.includes('@internal/b'), true);
    strictEqual(output.includes('">=24"'), true);
    strictEqual(output.includes(NODE_ENGINES_RANGE), true);
  });

  it('emits structured JSON when --json is passed', () => {
    const { io, stdout } = makeIo([
      { dir: 'packages/a', publishable: true, manifest: { name: '@prisma/orm-a' } },
    ]);
    strictEqual(runCheck({ argv: ['--json'], io }), 1);
    deepStrictEqual(JSON.parse(stdout.join('')), {
      ok: false,
      nodeEnginesRange: NODE_ENGINES_RANGE,
      offenders: [{ dir: 'packages/a', name: '@prisma/orm-a', reason: 'missing' }],
    });
  });
});
