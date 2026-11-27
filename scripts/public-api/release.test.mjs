import { deepStrictEqual, rejects, strictEqual, throws } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  compareVersions,
  fetchPackument,
  isExemptExport,
  isReleased,
  isVersion,
  LastReleaseError,
  lastRelease,
  packagesAtTag,
  releaseTags,
  versionAtRef,
} from './release.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const work = join(here, '..', '..', 'wip', `release-tests-${process.pid}`);
const origin = join(work, 'origin');
const clone = join(work, 'clone');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

before(() => {
  mkdirSync(origin, { recursive: true });
  git(origin, 'init', '--quiet', '--initial-branch=main');
  git(origin, 'config', 'user.email', 'test@example.com');
  git(origin, 'config', 'user.name', 'test');
  git(origin, 'config', 'commit.gpgSign', 'false');
  git(origin, 'config', 'tag.gpgSign', 'false');
  writeFileSync(join(origin, 'package.json'), JSON.stringify({ version: '1.1.0-rc.2' }));
  git(origin, 'add', '.');
  git(origin, 'commit', '--quiet', '-m', 'bump');
  for (const tag of ['v1.0.0', 'v1.1.0-rc.1', 'v1.1.0-rc.1-dev.3', 'v1.2.0', 'not-a-version']) {
    git(origin, 'tag', tag);
  }
  git(work, 'clone', '--quiet', `file://${origin}`, clone);
});
after(() => rmSync(work, { recursive: true, force: true }));

describe('lastRelease', () => {
  it('is the newest release tag at or below the version at the base ref', async () => {
    deepStrictEqual(await lastRelease({ root: clone, base: 'origin/main' }), {
      version: '1.1.0-rc.1',
      tag: 'v1.1.0-rc.1',
      base: 'origin/main',
      baseVersion: '1.1.0-rc.2',
    });
  });

  it('is the version at the base ref once its tag exists', async () => {
    const release = await lastRelease({
      root: clone,
      base: 'origin/main',
      versionAt: () => '1.2.0',
    });
    strictEqual(release.version, '1.2.0');
  });

  it('fails when no release tag is at or below it', async () => {
    await rejects(
      lastRelease({ root: clone, base: 'origin/main', versionAt: () => '0.9.0' }),
      (error) => {
        strictEqual(error instanceof LastReleaseError, true);
        strictEqual(
          error.message,
          'origin has no release tag at or below 0.9.0, the version at origin/main',
        );
        return true;
      },
    );
  });
});

describe('releaseTags', () => {
  it('lists the release tags, without dev builds or other tags', async () => {
    deepStrictEqual((await releaseTags(clone)).sort(compareVersions), [
      '1.0.0',
      '1.1.0-rc.1',
      '1.2.0',
    ]);
  });

  it('tries again when git fails, and then fails with what git said', async () => {
    const broken = join(work, 'broken');
    git(work, 'clone', '--quiet', `file://${origin}`, broken);
    git(broken, 'remote', 'set-url', 'origin', `file://${join(work, 'missing')}`);
    await rejects(releaseTags(broken, { attempts: 2, retryDelayMs: 0 }), (error) => {
      strictEqual(error instanceof LastReleaseError, true);
      strictEqual(
        error.message.startsWith('git ls-remote origin, after 2 attempts, failed: '),
        true,
      );
      return true;
    });
  });
});

describe('versionAtRef', () => {
  it('reads the root package.json version at a ref', () => {
    strictEqual(versionAtRef(clone, 'origin/main'), '1.1.0-rc.2');
  });
});

describe('packagesAtTag', () => {
  const repository = join(work, 'packages');
  const release = (tag, root, versions) => {
    writeFileSync(join(repository, 'package.json'), JSON.stringify({ version: root }));
    for (const [name, version] of Object.entries(versions)) {
      const dir = join(repository, 'packages', '9-public', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }));
    }
    git(repository, 'add', '.');
    git(repository, 'commit', '--quiet', '-m', tag);
    git(repository, 'tag', tag);
  };

  before(() => {
    mkdirSync(repository, { recursive: true });
    git(repository, 'init', '--quiet', '--initial-branch=main');
    git(repository, 'config', 'user.email', 'test@example.com');
    git(repository, 'config', 'user.name', 'test');
    git(repository, 'config', 'commit.gpgSign', 'false');
    release('v8.0.0-rc.25', '8.0.0-rc.25', {
      '@prisma/orm-postgres': '8.0.0-rc.25',
      '@prisma/orm-mysql': '8.0.0-rc.25',
      '@prisma/orm-extension-paradedb': '8.0.0-rc.25',
    });
    release('v8.0.1', '8.0.1', {
      '@prisma/orm-postgres': '8.0.1',
      '@prisma/orm-mysql': '8.0.1-ea.0',
      '@prisma/orm-extension-paradedb': '0.18.0',
    });
    release('v8.1.0', '8.1.0', {
      '@prisma/orm-postgres': '8.1.0',
      '@prisma/orm-mysql': '8.1.0',
      '@prisma/orm-extension-paradedb': '0.18.0',
    });
  });

  it('names every package at a release candidate with the release candidate', () => {
    deepStrictEqual(packagesAtTag('v8.0.0-rc.25', repository), [
      { name: '@prisma/orm-extension-paradedb', version: '8.0.0-rc.25' },
      { name: '@prisma/orm-mysql', version: '8.0.0-rc.25' },
      { name: '@prisma/orm-postgres', version: '8.0.0-rc.25' },
    ]);
  });

  it('names each package at a release with levels with the version it was released at: GA, Early Access, or its own', () => {
    deepStrictEqual(packagesAtTag('v8.0.1', repository), [
      { name: '@prisma/orm-extension-paradedb', version: '0.18.0' },
      { name: '@prisma/orm-mysql', version: '8.0.1-ea.0' },
      { name: '@prisma/orm-postgres', version: '8.0.1' },
    ]);
  });

  it('fails on a package without a version at the tag, naming the file and the tag', () => {
    const dir = join(repository, 'packages', '9-public', '@prisma', 'orm-broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@prisma/orm-broken' }));
    git(repository, 'add', '.');
    git(repository, 'commit', '--quiet', '-m', 'broken');
    git(repository, 'tag', 'v8.2.0');
    throws(
      () => packagesAtTag('v8.2.0', repository),
      (error) => {
        strictEqual(error instanceof LastReleaseError, true);
        strictEqual(
          error.message,
          'packages/9-public/@prisma/orm-broken/package.json at v8.2.0 has no version',
        );
        return true;
      },
    );
  });

  it('reads a package promoted after a release at the level it had at that release', () => {
    deepStrictEqual(
      packagesAtTag('v8.0.1', repository).find(({ name }) => name === '@prisma/orm-mysql'),
      { name: '@prisma/orm-mysql', version: '8.0.1-ea.0' },
    );
    deepStrictEqual(
      packagesAtTag('v8.1.0', repository).find(({ name }) => name === '@prisma/orm-mysql'),
      { name: '@prisma/orm-mysql', version: '8.1.0' },
    );
  });
});

describe('isReleased', () => {
  it('is whether the package has a version equal to the last release', async () => {
    const packument = async (name) =>
      name === '@prisma/orm-a' ? { versions: { '8.0.0-rc.25': {} } } : undefined;
    deepStrictEqual(
      await Promise.all(
        ['@prisma/orm-a', '@prisma/orm-unknown'].map((name) =>
          isReleased(name, '8.0.0-rc.25', packument),
        ),
      ),
      [true, false],
    );
  });
});

describe('fetchPackument', () => {
  it('retries a request that does not reach the registry', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls < 3) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ versions: {} }), { status: 200 });
    };
    deepStrictEqual(await fetchPackument('@prisma/orm-a', { fetchImpl, retryDelayMs: 0 }), {
      versions: {},
    });
    strictEqual(calls, 3);
  });

  it('does not retry an error the registry answers', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response('', { status: 500 });
    };
    await rejects(fetchPackument('@prisma/orm-a', { fetchImpl, retryDelayMs: 0 }), {
      message: 'could not read @prisma/orm-a from the registry: it answered 500',
    });
    strictEqual(calls, 1);
  });

  it('ends in one message naming what failed when every attempt fails', async () => {
    const fetchImpl = async () => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') });
    };
    await rejects(fetchPackument('@prisma/orm-a', { fetchImpl, retryDelayMs: 0 }), {
      message:
        'could not read @prisma/orm-a from the registry after 3 attempts: fetch failed (getaddrinfo ENOTFOUND)',
    });
  });
});

describe('the version rules', () => {
  it('orders versions as semver does', () => {
    deepStrictEqual(
      ['1.0.0', '1.0.0-rc.10', '0.9.0', '1.0.0-rc.2', '1.0.0-dev.1', '1.1.0'].sort(compareVersions),
      ['0.9.0', '1.0.0-dev.1', '1.0.0-rc.2', '1.0.0-rc.10', '1.0.0', '1.1.0'],
    );
  });

  it('orders numeric identifiers of any length exactly', () => {
    deepStrictEqual(
      ['8.0.0-rc.9007199254740993', '8.0.0-rc.9007199254740992', '8.0.0-rc.10', '8.0.0-rc.2'].sort(
        compareVersions,
      ),
      ['8.0.0-rc.2', '8.0.0-rc.10', '8.0.0-rc.9007199254740992', '8.0.0-rc.9007199254740993'],
    );
  });

  it('is not a version with an empty pre-release identifier', () => {
    deepStrictEqual(['8.0.0-rc..1', '8.0.0-.rc', '8.0.0-rc.', '8.0.0-rc.1'].map(isVersion), [
      false,
      false,
      false,
      true,
    ]);
  });

  it('exempts rc_, preview_ and ea_ exports, capitalised for a type or class', () => {
    const exempt = ['rc_x', 'preview_x', 'ea_x', 'Rc_X', 'Preview_X', 'Ea_X'];
    const held = ['x', 'rcx', 'Early', 'EA_X'];
    deepStrictEqual(exempt.filter(isExemptExport), exempt);
    deepStrictEqual(held.filter(isExemptExport), []);
  });
});
