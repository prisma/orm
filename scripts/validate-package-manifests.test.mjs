import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyPackage,
  classifyRepository,
  isAcceptedLicense,
  runCheck,
} from './validate-package-manifests.mjs';

const REPO_URL = 'https://github.com/prisma/orm.git';

function recorder() {
  const calls = [];
  const fn = (s) => calls.push(s);
  fn.output = () => calls.join('');
  fn.calls = calls;
  return fn;
}

describe('isAcceptedLicense', () => {
  it('accepts the SPDX identifier "Apache-2.0"', () => {
    assert.equal(isAcceptedLicense('Apache-2.0'), true);
  });

  it('rejects other SPDX identifiers, even compatible ones', () => {
    assert.equal(isAcceptedLicense('MIT'), false);
    assert.equal(isAcceptedLicense('BSD-3-Clause'), false);
    assert.equal(isAcceptedLicense('Apache-2.0 OR MIT'), false);
    assert.equal(isAcceptedLicense('SEE LICENSE IN LICENSE'), false);
  });

  it('rejects loose / undeclared values', () => {
    assert.equal(isAcceptedLicense(undefined), false);
    assert.equal(isAcceptedLicense(null), false);
    assert.equal(isAcceptedLicense(''), false);
    assert.equal(isAcceptedLicense('UNLICENSED'), false);
  });

  it('rejects non-string values', () => {
    assert.equal(isAcceptedLicense(0), false);
    assert.equal(isAcceptedLicense(true), false);
    assert.equal(isAcceptedLicense({ type: 'Apache-2.0' }), false);
  });
});

describe('classifyPackage', () => {
  it('returns null for a conforming manifest', () => {
    assert.equal(
      classifyPackage({
        name: '@internal/example',
        version: '1.0.0',
        license: 'Apache-2.0',
      }),
      null,
    );
  });

  it('flags a missing license field with reason "missing"', () => {
    assert.deepEqual(classifyPackage({ name: '@internal/example', version: '1.0.0' }), {
      name: '@internal/example',
      license: undefined,
      reason: 'missing',
    });
  });

  it('flags an empty-string license with reason "missing"', () => {
    assert.deepEqual(classifyPackage({ name: '@internal/example', license: '' }), {
      name: '@internal/example',
      license: '',
      reason: 'missing',
    });
  });

  it('flags a wrong-value license with reason "wrong" and preserves the value', () => {
    assert.deepEqual(classifyPackage({ name: '@internal/example', license: 'MIT' }), {
      name: '@internal/example',
      license: 'MIT',
      reason: 'wrong',
    });
  });

  it('flags a malformed license object with reason "wrong"', () => {
    const offence = classifyPackage({
      name: '@internal/example',
      license: { type: 'Apache-2.0', url: 'https://example.com' },
    });
    assert.equal(offence.name, '@internal/example');
    assert.equal(offence.reason, 'wrong');
  });

  it('falls back to "<unnamed>" when name is missing (defence in depth)', () => {
    assert.deepEqual(classifyPackage({}), {
      name: '<unnamed>',
      license: undefined,
      reason: 'missing',
    });
  });
});

describe('classifyRepository', () => {
  const dir = 'packages/9-public/@prisma/orm-postgres';

  function conforming() {
    return {
      name: '@prisma/orm-postgres',
      repository: { type: 'git', url: REPO_URL, directory: dir },
    };
  }

  it('returns null for a conforming manifest', () => {
    assert.equal(classifyRepository(conforming(), dir), null);
  });

  it('flags a missing repository field', () => {
    assert.deepEqual(classifyRepository({ name: '@prisma/orm-postgres' }, dir), {
      name: '@prisma/orm-postgres',
      repository: undefined,
      reason: 'repository-missing',
    });
  });

  it('flags a wrong url — npm provenance verification rejects the tarball', () => {
    const pkg = conforming();
    pkg.repository.url = 'https://github.com/prisma/some-other-repo.git';
    assert.equal(classifyRepository(pkg, dir).reason, 'repository-wrong');
  });

  it('flags an empty url', () => {
    const pkg = conforming();
    pkg.repository.url = '';
    assert.equal(classifyRepository(pkg, dir).reason, 'repository-wrong');
  });

  it('flags a directory not matching the package location', () => {
    const pkg = conforming();
    pkg.repository.directory = 'packages/somewhere-else';
    assert.equal(classifyRepository(pkg, dir).reason, 'repository-wrong');
  });

  it('flags a string-form repository', () => {
    assert.equal(
      classifyRepository({ name: '@prisma/orm-postgres', repository: `git+${REPO_URL}` }, dir)
        .reason,
      'repository-wrong',
    );
  });
});

describe('runCheck', () => {
  function conformingManifest(name, dir) {
    return {
      name,
      version: '1.0.0',
      license: 'Apache-2.0',
      repository: { type: 'git', url: REPO_URL, directory: dir },
    };
  }

  function makeIo(overrides = {}) {
    return {
      listPublishablePackageDirs: () => [],
      readPackageJson: (dir) => conformingManifest('@scope/x', dir),
      stdoutWrite: recorder(),
      stderrWrite: recorder(),
      ...overrides,
    };
  }

  it('returns 0 on a fully conforming workspace', () => {
    const io = makeIo({
      listPublishablePackageDirs: () => ['packages/a', 'packages/b'],
      readPackageJson: (dir) => conformingManifest(`@scope/${dir.split('/').pop()}`, dir),
    });
    assert.equal(runCheck({ argv: [], io }), 0);
    assert.equal(io.stdoutWrite.calls.length, 0);
  });

  it('returns 1 when a publishable package is missing a license', () => {
    const io = makeIo({
      listPublishablePackageDirs: () => ['packages/a', 'packages/missing'],
      readPackageJson: (dir) => {
        const pkg = conformingManifest(
          dir === 'packages/missing' ? '@scope/missing' : '@scope/a',
          dir,
        );
        if (dir === 'packages/missing') delete pkg.license;
        return pkg;
      },
    });
    assert.equal(runCheck({ argv: [], io }), 1);
    const stderr = io.stderrWrite.output();
    assert.match(stderr, /FAIL/);
    assert.match(stderr, /@scope\/missing/);
    assert.match(stderr, /no "license" field/);
  });

  it('returns 1 when a publishable package declares the wrong license', () => {
    const io = makeIo({
      listPublishablePackageDirs: () => ['packages/wrong'],
      readPackageJson: (dir) => ({ ...conformingManifest('@scope/wrong', dir), license: 'MIT' }),
    });
    assert.equal(runCheck({ argv: [], io }), 1);
    const stderr = io.stderrWrite.output();
    assert.match(stderr, /@scope\/wrong/);
    assert.match(stderr, /"MIT"/);
    assert.match(stderr, /expected "Apache-2.0"/);
  });

  it('returns 1 when a publishable package has no repository field', () => {
    const io = makeIo({
      listPublishablePackageDirs: () => ['packages/9-public/@prisma/orm-postgres'],
      readPackageJson: () => ({ name: '@prisma/orm-postgres', license: 'Apache-2.0' }),
    });
    assert.equal(runCheck({ argv: [], io }), 1);
    const stderr = io.stderrWrite.output();
    assert.match(stderr, /repository/);
    assert.match(stderr, /@prisma\/orm-postgres/);
  });

  it('returns 1 when repository.url does not match the canonical repo', () => {
    const dir = 'packages/9-public/@prisma/orm-postgres';
    const io = makeIo({
      listPublishablePackageDirs: () => [dir],
      readPackageJson: () => ({
        ...conformingManifest('@prisma/orm-postgres', dir),
        repository: { type: 'git', url: '', directory: dir },
      }),
    });
    assert.equal(runCheck({ argv: [], io }), 1);
    assert.match(io.stderrWrite.output(), /repository/);
  });

  it('emits structured JSON when --json is passed', () => {
    const dir = 'packages/missing';
    const io = makeIo({
      listPublishablePackageDirs: () => [dir],
      readPackageJson: () => ({
        name: '@scope/missing',
        version: '1.0.0',
        repository: { type: 'git', url: REPO_URL, directory: dir },
      }),
    });
    assert.equal(runCheck({ argv: ['--json'], io }), 1);
    assert.equal(io.stdoutWrite.calls.length, 1);

    const payload = JSON.parse(io.stdoutWrite.calls[0]);
    assert.equal(payload.ok, false);
    assert.deepEqual(payload.offenders, [
      { dir: 'packages/missing', name: '@scope/missing', reason: 'missing' },
    ]);
  });

  it('emits structured JSON with ok=true when the workspace conforms', () => {
    const io = makeIo({
      listPublishablePackageDirs: () => ['packages/a'],
    });
    assert.equal(runCheck({ argv: ['--json'], io }), 0);
    const payload = JSON.parse(io.stdoutWrite.calls[0]);
    assert.deepEqual(payload, { ok: true, offenders: [] });
  });

  it('reports every offender, not just the first', () => {
    const io = makeIo({
      listPublishablePackageDirs: () => ['packages/a', 'packages/b', 'packages/c'],
      readPackageJson: (dir) => {
        if (dir === 'packages/a') return conformingManifest('@scope/a', dir);
        if (dir === 'packages/b') {
          const pkg = conformingManifest('@scope/b', dir);
          delete pkg.license;
          return pkg;
        }
        return { ...conformingManifest('@scope/c', dir), license: 'GPL-3.0' };
      },
    });
    assert.equal(runCheck({ argv: ['--json'], io }), 1);
    const payload = JSON.parse(io.stdoutWrite.calls[0]);
    assert.deepEqual(payload.offenders.map((o) => o.name).sort(), ['@scope/b', '@scope/c']);
  });
});
