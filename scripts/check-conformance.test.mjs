import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bareImportSpecifiersIn,
  computeOverrides,
  declaredBins,
  findEnginePinViolations,
  findImportPurityViolations,
  findValidatorViolations,
  HOSTILE_INPUTS,
  isSectionValidation,
  packageRootOf,
  packedEntrySpecifiers,
  runCheck,
} from './check-conformance.mjs';

function recorder() {
  const calls = [];
  const fn = (...args) => calls.push(args);
  fn.calls = calls;
  return fn;
}

describe('packageRootOf', () => {
  it('maps a subpath specifier to its package root', () => {
    assert.equal(packageRootOf('lodash/merge'), 'lodash');
    assert.equal(packageRootOf('@scope/pkg/deep/file.js'), '@scope/pkg');
    assert.equal(packageRootOf('pathe'), 'pathe');
  });

  it('returns null for relative and absolute paths, subpath imports, and builtins', () => {
    assert.equal(packageRootOf('./local.mjs'), null);
    assert.equal(packageRootOf('../up.mjs'), null);
    assert.equal(packageRootOf('/abs/path.mjs'), null);
    assert.equal(packageRootOf('#private/thing'), null);
    assert.equal(packageRootOf('node:fs'), null);
    assert.equal(packageRootOf('fs'), null);
    assert.equal(packageRootOf('fs/promises'), null);
  });
});

describe('bareImportSpecifiersIn', () => {
  it('reports static imports, re-exports, and dynamic import()', async () => {
    const source = [
      "import { a } from 'pkg-static';",
      "export { b } from '@scope/reexported';",
      "const c = await import('pkg-dynamic');",
    ].join('\n');
    const found = await bareImportSpecifiersIn(source, 'dist/index.mjs');
    assert.deepEqual(found.map((f) => f.root).sort(), [
      '@scope/reexported',
      'pkg-dynamic',
      'pkg-static',
    ]);
    assert.equal(found[0].file, 'dist/index.mjs');
  });

  it('does not report package names in strings or import.meta.resolve arguments', async () => {
    const source = [
      "const name = 'sneaky-string-pkg';",
      "const url = import.meta.resolve('resolved-not-imported');",
      "import 'actually-imported';",
    ].join('\n');
    const found = await bareImportSpecifiersIn(source, 'dist/index.mjs');
    assert.deepEqual(
      found.map((f) => f.specifier),
      ['actually-imported'],
    );
  });

  it('skips relative imports and node builtins', async () => {
    const source = [
      "import './local.mjs';",
      "import 'node:path';",
      "import 'fs';",
      "import 'real-pkg';",
    ].join('\n');
    const found = await bareImportSpecifiersIn(source, 'dist/index.mjs');
    assert.deepEqual(
      found.map((f) => f.specifier),
      ['real-pkg'],
    );
  });

  it('skips a dynamic import whose specifier is not a plain string', async () => {
    const found = await bareImportSpecifiersIn('const m = await import(name);', 'dist/x.mjs');
    assert.deepEqual(found, []);
  });
});

describe('findImportPurityViolations', () => {
  const manifest = {
    name: '@prisma/example',
    dependencies: { declared: '1.0.0' },
    peerDependencies: { peered: '^2.0.0' },
    optionalDependencies: { optional: '3.0.0' },
  };

  it('passes imports declared in dependencies, peerDependencies, or optionalDependencies', () => {
    const violations = findImportPurityViolations({
      manifest,
      imports: [
        { root: 'declared', specifier: 'declared/sub', file: 'dist/a.mjs' },
        { root: 'peered', specifier: 'peered', file: 'dist/a.mjs' },
        { root: 'optional', specifier: 'optional', file: 'dist/a.mjs' },
      ],
    });
    assert.deepEqual(violations, []);
  });

  it('flags a bare import the packed manifest does not declare', () => {
    const violations = findImportPurityViolations({
      manifest,
      imports: [{ root: 'phantom', specifier: 'phantom/deep', file: 'dist/a.mjs' }],
    });
    assert.deepEqual(violations, [
      { kind: 'undeclared', root: 'phantom', specifier: 'phantom/deep', file: 'dist/a.mjs' },
    ]);
  });

  it('does not count devDependencies as declared', () => {
    const violations = findImportPurityViolations({
      manifest: { ...manifest, devDependencies: { devonly: '1.0.0' } },
      imports: [{ root: 'devonly', specifier: 'devonly', file: 'dist/a.mjs' }],
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].kind, 'undeclared');
  });

  it('flags @internal/* and @repo/* imports even when declared', () => {
    const violations = findImportPurityViolations({
      manifest: {
        ...manifest,
        dependencies: { '@internal/utils': '1.0.0', '@repo/tsconfig': '1.0.0' },
      },
      imports: [
        { root: '@internal/utils', specifier: '@internal/utils/casts', file: 'dist/a.mjs' },
        { root: '@repo/tsconfig', specifier: '@repo/tsconfig', file: 'dist/b.mjs' },
      ],
    });
    assert.deepEqual(
      violations.map((v) => v.kind),
      ['internal', 'internal'],
    );
  });

  it('reports each undeclared specifier once', () => {
    const violations = findImportPurityViolations({
      manifest,
      imports: [
        { root: 'phantom', specifier: 'phantom', file: 'dist/a.mjs' },
        { root: 'phantom', specifier: 'phantom', file: 'dist/b.mjs' },
      ],
    });
    assert.equal(violations.length, 1);
  });
});

describe('HOSTILE_INPUTS', () => {
  it('covers the full fixed corpus', () => {
    assert.ok(HOSTILE_INPUTS.length >= 21);
    for (const input of HOSTILE_INPUTS) {
      assert.equal(typeof input.label, 'string');
      assert.equal(typeof input.make, 'function');
      input.make();
    }
  });
});

describe('isSectionValidation', () => {
  it('accepts both well-formed shapes', () => {
    assert.equal(isSectionValidation({ ok: true, value: {}, diagnostics: [] }), true);
    assert.equal(isSectionValidation({ ok: false, diagnostics: [{ code: 'X' }] }), true);
  });

  it('rejects malformed returns', () => {
    assert.equal(isSectionValidation(undefined), false);
    assert.equal(isSectionValidation(null), false);
    assert.equal(isSectionValidation({}), false);
    assert.equal(isSectionValidation({ ok: true, diagnostics: [] }), false);
    assert.equal(isSectionValidation({ ok: false, diagnostics: 'nope' }), false);
    assert.equal(isSectionValidation({ ok: 'yes', diagnostics: [] }), false);
  });
});

describe('findValidatorViolations', () => {
  it('returns no violations for a validator that always returns a SectionValidation', () => {
    const section = { name: 'orm', validate: () => ({ ok: false, diagnostics: [] }) };
    assert.deepEqual(findValidatorViolations(section), []);
  });

  it('reports every hostile input the validator throws on', () => {
    const section = {
      name: 'orm',
      validate: (value) => {
        if (value === null || value === undefined) throw new Error('boom');
        return { ok: false, diagnostics: [] };
      },
    };
    const violations = findValidatorViolations(section);
    assert.deepEqual(
      violations.map((v) => [v.kind, v.label]),
      [
        ['threw', 'undefined'],
        ['threw', 'null'],
      ],
    );
    assert.match(violations[0].message, /boom/);
  });

  it('reports a malformed return as a violation', () => {
    const section = { name: 'orm', validate: () => 'not a SectionValidation' };
    const violations = findValidatorViolations(section);
    assert.equal(violations.length, HOSTILE_INPUTS.length);
    assert.ok(violations.every((v) => v.kind === 'malformed'));
  });
});

describe('computeOverrides', () => {
  it('maps workspace siblings to version-qualified keys with absolute file: paths', () => {
    const packedByName = new Map([
      [
        '@prisma/orm-toolchain',
        {
          tarballPath: '/abs/toolchain.tgz',
          manifest: {
            name: '@prisma/orm-toolchain',
            dependencies: { '@prisma/orm-framework': '8.0.0-rc.1', pathe: '^2.0.3' },
          },
        },
      ],
      [
        '@prisma/orm-framework',
        {
          tarballPath: '/abs/framework.tgz',
          manifest: {
            name: '@prisma/orm-framework',
            dependencies: { '@prisma/orm-family-sql': '8.0.0-rc.1', arktype: '^2.2.2' },
          },
        },
      ],
      [
        '@prisma/orm-family-sql',
        {
          tarballPath: '/abs/family-sql.tgz',
          manifest: { name: '@prisma/orm-family-sql', dependencies: {} },
        },
      ],
    ]);
    const overrides = computeOverrides({ rootName: '@prisma/orm-toolchain', packedByName });
    assert.deepEqual(overrides, {
      '@prisma/orm-framework@8.0.0-rc.1': 'file:/abs/framework.tgz',
      '@prisma/orm-family-sql@8.0.0-rc.1': 'file:/abs/family-sql.tgz',
    });
  });

  it('tolerates a dependency cycle between workspace siblings', () => {
    const packedByName = new Map([
      ['a', { tarballPath: '/abs/a.tgz', manifest: { name: 'a', dependencies: { b: '1.0.0' } } }],
      ['b', { tarballPath: '/abs/b.tgz', manifest: { name: 'b', dependencies: { a: '1.0.0' } } }],
    ]);
    const overrides = computeOverrides({ rootName: 'a', packedByName });
    assert.deepEqual(overrides, {
      'b@1.0.0': 'file:/abs/b.tgz',
      'a@1.0.0': 'file:/abs/a.tgz',
    });
  });
});

describe('findEnginePinViolations', () => {
  it('passes when every declarer pins the same exact version', () => {
    const violations = findEnginePinViolations({
      packedPins: [{ pkg: '@prisma/orm-toolchain', spec: '0.0.9' }],
      sourcePin: { pkg: '@internal/cli', spec: '0.0.9' },
    });
    assert.deepEqual(violations, []);
  });

  it('reports a disagreement naming both packages and both versions', () => {
    const violations = findEnginePinViolations({
      packedPins: [{ pkg: '@prisma/orm-toolchain', spec: '0.0.9' }],
      sourcePin: { pkg: '@internal/cli', spec: '0.1.0' },
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].kind, 'disagreement');
    assert.match(violations[0].message, /@prisma\/orm-toolchain.*0\.0\.9/);
    assert.match(violations[0].message, /@internal\/cli.*0\.1\.0/);
  });

  it('reports a non-exact pin', () => {
    const violations = findEnginePinViolations({
      packedPins: [{ pkg: '@prisma/orm-toolchain', spec: '^0.0.9' }],
      sourcePin: { pkg: '@internal/cli', spec: '^0.0.9' },
    });
    assert.deepEqual(
      violations.map((v) => v.kind),
      ['not-exact', 'not-exact'],
    );
  });

  it('reports a finding when no packed manifest declares the engine (anti-vacuity)', () => {
    const violations = findEnginePinViolations({
      packedPins: [],
      sourcePin: { pkg: '@internal/cli', spec: '0.0.9' },
    });
    assert.deepEqual(
      violations.map((v) => v.kind),
      ['no-subjects'],
    );
  });
});

describe('runCheck', () => {
  const cleanJs = "import 'declared';\nexport const x = 1;\n";

  function makeIo(overrides = {}) {
    const io = {
      listPublishablePackageDirs: () => ['packages/9-public/@prisma/orm-toolchain'],
      readPackageJson: () => ({ name: '@prisma/orm-toolchain', version: '8.0.0-rc.1' }),
      prepareConformanceDir: () => ({
        tarballDir: '/fake/.conformance/tarballs',
        sandboxDir: '/fake/.conformance/sandbox',
      }),
      packAll: () => 0,
      readdirSync: () => ['prisma-orm-toolchain-8.0.0-rc.1.tgz'],
      readPackedManifest: () => ({
        name: '@prisma/orm-toolchain',
        version: '8.0.0-rc.1',
        dependencies: { declared: '1.0.0' },
        peerDependencies: { '@prisma/cli-engine': '0.0.9' },
        bin: { 'prisma-cli': './dist/bin__prisma-cli.mjs' },
      }),
      readPackedJsSources: () => new Map([['dist/index.mjs', cleanJs]]),
      listPackedCommonJs: () => [],
      loadOrmConfigSection: async () => ({
        name: 'orm',
        validate: () => ({ ok: false, diagnostics: [] }),
      }),
      readSourceCliEnginePin: () => '0.0.9',
      installSandbox: async () => ({ ok: true, output: '' }),
      runBin: async () => ({ exitCode: 0, stdout: '8.0.0-rc.1', stderr: '', timedOut: false }),
      stdoutWrite: () => {},
      stderrWrite: () => {},
      ...overrides,
    };
    return io;
  }

  it('returns 0 on a clean run', async () => {
    assert.equal(await runCheck({ argv: [], io: makeIo() }), 0);
  });

  it('reports a finding when there are no publishable packages (anti-vacuity)', async () => {
    const stdoutWrite = recorder();
    const io = makeIo({ listPublishablePackageDirs: () => [], stdoutWrite });
    assert.equal(await runCheck({ argv: ['--json'], io }), 1);
    const payload = JSON.parse(stdoutWrite.calls[0][0]);
    assert.equal(payload.ok, false);
    assert.ok(payload.findings.some((f) => f.kind === 'no-subjects'));
  });

  it('reports a finding when no tarball ships any JavaScript (anti-vacuity)', async () => {
    const io = makeIo({ readPackedJsSources: () => new Map() });
    assert.equal(await runCheck({ argv: [], io }), 1);
  });

  it('propagates a pack failure exit code', async () => {
    const io = makeIo({ packAll: () => 2 });
    assert.equal(await runCheck({ argv: [], io }), 2);
  });

  it('fails when packed output imports an undeclared package', async () => {
    const stdoutWrite = recorder();
    const io = makeIo({
      readPackedJsSources: () => new Map([['dist/index.mjs', "import 'phantom';\n"]]),
      stdoutWrite,
    });
    assert.equal(await runCheck({ argv: ['--json'], io }), 1);
    const payload = JSON.parse(stdoutWrite.calls[0][0]);
    assert.ok(payload.findings.some((f) => f.check === 'import-purity' && f.kind === 'undeclared'));
  });

  it('fails when packed output imports an @internal/* package', async () => {
    const io = makeIo({
      readPackedJsSources: () => new Map([['dist/index.mjs', "import '@internal/utils';\n"]]),
    });
    assert.equal(await runCheck({ argv: [], io }), 1);
  });

  it('fails when the shipped validator throws', async () => {
    const io = makeIo({
      loadOrmConfigSection: async () => ({
        name: 'orm',
        validate: () => {
          throw new Error('validator exploded');
        },
      }),
    });
    assert.equal(await runCheck({ argv: [], io }), 1);
  });

  it('fails when the shipped validator cannot be loaded (anti-vacuity)', async () => {
    const stdoutWrite = recorder();
    const io = makeIo({
      loadOrmConfigSection: async () => {
        throw new Error('dist file missing');
      },
      stdoutWrite,
    });
    assert.equal(await runCheck({ argv: ['--json'], io }), 1);
    const payload = JSON.parse(stdoutWrite.calls[0][0]);
    assert.ok(payload.findings.some((f) => f.check === 'validator-no-throw'));
  });

  it('fails when the sandbox install fails, reporting npm output', async () => {
    const stdoutWrite = recorder();
    const io = makeIo({
      installSandbox: async () => ({ ok: false, output: 'ERESOLVE unable to resolve' }),
      stdoutWrite,
    });
    assert.equal(await runCheck({ argv: ['--json'], io }), 1);
    const payload = JSON.parse(stdoutWrite.calls[0][0]);
    const finding = payload.findings.find((f) => f.kind === 'install-failed');
    assert.match(finding.detail, /ERESOLVE/);
  });

  it('fails when a bin exits non-zero or times out', async () => {
    const nonZero = makeIo({
      runBin: async () => ({ exitCode: 1, stdout: '', stderr: 'crash', timedOut: false }),
    });
    assert.equal(await runCheck({ argv: [], io: nonZero }), 1);

    const timedOut = makeIo({
      runBin: async () => ({ exitCode: null, stdout: '', stderr: '', timedOut: true }),
    });
    assert.equal(await runCheck({ argv: [], io: timedOut }), 1);
  });

  it('starts every entry in the packed bin map', async () => {
    const runBin = recorder();
    const io = makeIo({
      readPackedManifest: () => ({
        name: '@prisma/orm-toolchain',
        version: '8.0.0-rc.1',
        dependencies: { declared: '1.0.0' },
        peerDependencies: { '@prisma/cli-engine': '0.0.9' },
        bin: { 'prisma-cli': './dist/bin__prisma-cli.mjs', other: './dist/other.mjs' },
      }),
      runBin: async (...args) => {
        runBin(...args);
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      },
    });
    assert.equal(await runCheck({ argv: [], io }), 0);
    assert.equal(runBin.calls.length, 2);
    assert.deepEqual(runBin.calls.map((c) => c[0].relPath).sort(), [
      './dist/bin__prisma-cli.mjs',
      './dist/other.mjs',
    ]);
  });

  it('an engine in a packed dependencies field is a wrong-field finding, per ADR 0004', async () => {
    const stdoutWrite = recorder();
    const io = makeIo({
      readPackedManifest: () => ({
        name: '@prisma/orm-toolchain',
        version: '8.0.0-rc.1',
        dependencies: { declared: '1.0.0', '@prisma/cli-engine': '0.0.9' },
        bin: { 'prisma-cli': './dist/bin__prisma-cli.mjs' },
      }),
      stdoutWrite,
    });
    assert.equal(await runCheck({ argv: ['--json'], io }), 1);
    const payload = JSON.parse(stdoutWrite.calls[0][0]);
    assert.ok(payload.findings.some((f) => f.kind === 'wrong-field'));
  });

  it('fails when the engine pin disagrees between a packed manifest and the source cli', async () => {
    const stdoutWrite = recorder();
    const io = makeIo({ readSourceCliEnginePin: () => '0.1.0', stdoutWrite });
    assert.equal(await runCheck({ argv: ['--json'], io }), 1);
    const payload = JSON.parse(stdoutWrite.calls[0][0]);
    assert.ok(payload.findings.some((f) => f.kind === 'disagreement'));
  });

  it('emits a machine-readable report with --json on a clean run', async () => {
    const stdoutWrite = recorder();
    assert.equal(await runCheck({ argv: ['--json'], io: makeIo({ stdoutWrite }) }), 0);
    const payload = JSON.parse(stdoutWrite.calls[0][0]);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.findings, []);
  });

  it('passes computed overrides with version-qualified keys to the sandbox install', async () => {
    const installSandbox = recorder();
    const tarballs = {
      'prisma-orm-toolchain-8.0.0-rc.1.tgz': {
        name: '@prisma/orm-toolchain',
        version: '8.0.0-rc.1',
        dependencies: {
          declared: '1.0.0',
          '@prisma/orm-framework': '8.0.0-rc.1',
        },
        peerDependencies: { '@prisma/cli-engine': '0.0.9' },
        bin: { 'prisma-cli': './dist/bin__prisma-cli.mjs' },
      },
      'prisma-orm-framework-8.0.0-rc.1.tgz': {
        name: '@prisma/orm-framework',
        version: '8.0.0-rc.1',
        dependencies: { declared: '1.0.0' },
      },
    };
    const io = makeIo({
      listPublishablePackageDirs: () => [
        'packages/9-public/@prisma/orm-toolchain',
        'packages/9-public/@prisma/orm-framework',
      ],
      readPackageJson: (dir) =>
        dir.endsWith('orm-toolchain')
          ? { name: '@prisma/orm-toolchain', version: '8.0.0-rc.1' }
          : { name: '@prisma/orm-framework', version: '8.0.0-rc.1' },
      readdirSync: () => Object.keys(tarballs),
      readPackedManifest: (tgzPath) => {
        const name = Object.keys(tarballs).find((t) => tgzPath.endsWith(t));
        return tarballs[name];
      },
      installSandbox: async (...args) => {
        installSandbox(...args);
        return { ok: true, output: '' };
      },
    });
    assert.equal(await runCheck({ argv: [], io }), 0);
    assert.equal(installSandbox.calls.length, 1);
    assert.deepEqual(installSandbox.calls[0][0].overrides, {
      '@prisma/orm-framework@8.0.0-rc.1':
        'file:/fake/.conformance/tarballs/prisma-orm-framework-8.0.0-rc.1.tgz',
    });
  });

  it('a manifest with no bin smokes every published entry point', async () => {
    const importEntry = recorder();
    const io = makeIo({
      readPackedManifest: () => ({
        name: '@prisma/orm-toolchain',
        version: '8.0.0-rc.1',
        dependencies: { declared: '1.0.0' },
        peerDependencies: { '@prisma/cli-engine': '0.0.9' },
        exports: {
          './cli': './dist/cli.mjs',
          './emitter': './dist/emitter.mjs',
          './package.json': './package.json',
        },
      }),
      importEntry: async (...args) => {
        importEntry(...args);
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      },
    });
    assert.equal(await runCheck({ argv: [], io }), 0);
    assert.deepEqual(
      importEntry.calls.map((c) => c[0].specifier),
      ['@prisma/orm-toolchain/cli', '@prisma/orm-toolchain/emitter'],
    );
  });

  it('a failing entry import in the sandbox is a finding that names the entry', async () => {
    const stdoutWrite = recorder();
    const io = makeIo({
      readPackedManifest: () => ({
        name: '@prisma/orm-toolchain',
        version: '8.0.0-rc.1',
        dependencies: { declared: '1.0.0' },
        peerDependencies: { '@prisma/cli-engine': '0.0.9' },
        exports: { './cli': './dist/cli.mjs', './emitter': './dist/emitter.mjs' },
      }),
      importEntry: async ({ specifier }) =>
        specifier.endsWith('/emitter')
          ? { exitCode: 1, stdout: '', stderr: 'ERR_MODULE_NOT_FOUND', timedOut: false }
          : { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      stdoutWrite,
    });
    assert.equal(await runCheck({ argv: ['--json'], io }), 1);
    const payload = JSON.parse(stdoutWrite.calls[0][0]);
    const failed = payload.findings.filter((f) => f.kind === 'entry-failed');
    assert.equal(failed.length, 1);
    assert.match(failed[0].summary, /@prisma\/orm-toolchain\/emitter/);
    assert.match(failed[0].detail, /ERR_MODULE_NOT_FOUND/);
  });

  it('a bin-less manifest that exports nothing importable is a finding (anti-vacuity)', async () => {
    const stdoutWrite = recorder();
    const io = makeIo({
      readPackedManifest: () => ({
        name: '@prisma/orm-toolchain',
        version: '8.0.0-rc.1',
        dependencies: { declared: '1.0.0' },
        peerDependencies: { '@prisma/cli-engine': '0.0.9' },
        exports: { './package.json': './package.json' },
      }),
      stdoutWrite,
    });
    assert.equal(await runCheck({ argv: ['--json'], io }), 1);
    const payload = JSON.parse(stdoutWrite.calls[0][0]);
    assert.ok(
      payload.findings.some((f) => f.check === 'tarball' && f.kind === 'no-subjects'),
      'expected a tarball no-subjects finding',
    );
  });
});

describe('packedEntrySpecifiers', () => {
  it('joins each exported subpath onto the package name, sorted', () => {
    assert.deepEqual(
      packedEntrySpecifiers({
        name: '@prisma/orm-toolchain',
        exports: { './emitter': './dist/emitter.mjs', './cli': './dist/cli.mjs' },
      }),
      ['@prisma/orm-toolchain/cli', '@prisma/orm-toolchain/emitter'],
    );
  });

  it('names the package itself for the root export', () => {
    assert.deepEqual(packedEntrySpecifiers({ name: 'x', exports: { '.': './dist/index.mjs' } }), [
      'x',
    ]);
  });

  it('skips ./package.json, which is data rather than a module', () => {
    assert.deepEqual(
      packedEntrySpecifiers({
        name: 'x',
        exports: { './a': './dist/a.mjs', './package.json': './package.json' },
      }),
      ['x/a'],
    );
  });

  it('skips wildcard subpaths, which name no single module', () => {
    assert.deepEqual(
      packedEntrySpecifiers({
        name: 'x',
        exports: { './a': './dist/a.mjs', './g/*': './dist/g/*' },
      }),
      ['x/a'],
    );
  });

  it('reads the import condition of a conditional export', () => {
    assert.deepEqual(
      packedEntrySpecifiers({
        name: 'x',
        exports: { './a': { types: './dist/a.d.mts', import: './dist/a.mjs' } },
      }),
      ['x/a'],
    );
  });

  it('skips an export with no importable target', () => {
    assert.deepEqual(
      packedEntrySpecifiers({
        name: 'x',
        exports: { './a': { types: './dist/a.d.mts' }, './b': null, './c': './dist/c.mjs' },
      }),
      ['x/c'],
    );
  });

  it('treats the string shorthand as the root export', () => {
    assert.deepEqual(packedEntrySpecifiers({ name: 'x', exports: './dist/index.mjs' }), ['x']);
  });

  it('treats a bare conditions object as the root export, not as subpaths', () => {
    assert.deepEqual(
      packedEntrySpecifiers({
        name: 'x',
        exports: { types: './dist/index.d.mts', import: './dist/index.mjs' },
      }),
      ['x'],
    );
  });

  it('recognises node-addons, which Node resolves before node', () => {
    assert.deepEqual(
      packedEntrySpecifiers({ name: 'x', exports: { 'node-addons': './dist/native.mjs' } }),
      ['x'],
    );
    assert.deepEqual(
      packedEntrySpecifiers({ name: 'x', exports: { './a': { 'node-addons': './dist/a.mjs' } } }),
      ['x/a'],
    );
  });

  it('treats an array fallback as the root export', () => {
    assert.deepEqual(
      packedEntrySpecifiers({ name: 'x', exports: ['./dist/index.mjs', './dist/fallback.mjs'] }),
      ['x'],
    );
  });

  it('yields nothing for a bare conditions object with no importable condition', () => {
    assert.deepEqual(packedEntrySpecifiers({ name: 'x', exports: { types: './x.d.mts' } }), []);
  });

  it('yields nothing for a manifest with no exports', () => {
    assert.deepEqual(packedEntrySpecifiers({ name: 'x' }), []);
  });
});

describe('declaredBins', () => {
  it('expands the string shorthand under the unscoped package name', () => {
    assert.deepEqual(declaredBins({ name: '@prisma/orm-toolchain', bin: './dist/cli.mjs' }), [
      ['orm-toolchain', './dist/cli.mjs'],
    ]);
  });

  it('passes the object form through', () => {
    assert.deepEqual(declaredBins({ name: 'x', bin: { a: './a.mjs', b: './b.mjs' } }), [
      ['a', './a.mjs'],
      ['b', './b.mjs'],
    ]);
  });

  it('yields nothing for a manifest with no bin', () => {
    assert.deepEqual(declaredBins({ name: 'x' }), []);
  });
});
