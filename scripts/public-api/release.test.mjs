import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  compareVersions,
  fetchPackument,
  fetchReleaseTarball,
  isExemptExport,
  isReleased,
  isVersion,
  LastReleaseError,
  lastRelease,
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

  it('does not retry an answer that refuses the request', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response('', { status: 403 });
    };
    await rejects(fetchPackument('@prisma/orm-a', { fetchImpl, retryDelayMs: 0 }), {
      message: 'could not read @prisma/orm-a from the registry: it answered 403',
    });
    strictEqual(calls, 1);
  });

  it('retries a server error', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) return new Response('', { status: 503 });
      return new Response(JSON.stringify({ versions: {} }), { status: 200 });
    };
    deepStrictEqual(await fetchPackument('@prisma/orm-a', { fetchImpl, retryDelayMs: 0 }), {
      versions: {},
    });
    strictEqual(calls, 2);
  });

  it('waits longer before each further attempt', async () => {
    const started = Date.now();
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls < 3) throw new TypeError('fetch failed');
      return new Response('{}', { status: 200 });
    };
    await fetchPackument('@prisma/orm-a', { fetchImpl, retryDelayMs: 40 });
    strictEqual(Date.now() - started >= 110, true);
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

describe('fetchReleaseTarball', () => {
  const TARBALL = 'https://registry.npmjs.org/@prisma/orm-a/-/orm-a-8.0.0-rc.3.tgz';
  const bytes = Buffer.from('the tarball');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const packument = (dist) => async () => ({ versions: { '8.0.0-rc.3': { dist } } });
  const options = (fetchImpl, dist = { tarball: TARBALL, integrity }) => ({
    packument: packument(dist),
    fetchImpl,
    retryDelayMs: 0,
  });

  it('returns the tarball the registry lists for the version', async () => {
    const tarball = await fetchReleaseTarball(
      '@prisma/orm-a',
      '8.0.0-rc.3',
      options(async (url) => {
        strictEqual(url, TARBALL);
        return new Response(bytes);
      }),
    );
    deepStrictEqual(tarball, bytes);
  });

  it('is undefined when the registry has no such version', async () => {
    strictEqual(
      await fetchReleaseTarball('@prisma/orm-a', '8.0.0', {
        packument: async () => ({ versions: {} }),
      }),
      undefined,
    );
  });

  it('retries an answer that breaks off while it is read, and keeps the cause', async () => {
    let calls = 0;
    const broken = {
      ok: true,
      status: 200,
      arrayBuffer: async () => {
        throw new TypeError('terminated', { cause: new Error('ECONNRESET') });
      },
    };
    const fetchImpl = async () => (++calls === 1 ? broken : new Response(bytes));
    deepStrictEqual(
      await fetchReleaseTarball('@prisma/orm-a', '8.0.0-rc.3', options(fetchImpl)),
      bytes,
    );
    strictEqual(calls, 2);
    await rejects(
      fetchReleaseTarball(
        '@prisma/orm-a',
        '8.0.0-rc.3',
        options(async () => broken),
      ),
      {
        message: `could not read ${TARBALL} from the registry after 3 attempts: terminated (ECONNRESET)`,
      },
    );
  });

  it('refuses a tarball whose integrity does not match', async () => {
    const other = `sha512-${createHash('sha512').update('other').digest('base64')}`;
    await rejects(
      fetchReleaseTarball(
        '@prisma/orm-a',
        '8.0.0-rc.3',
        options(async () => new Response(bytes), { tarball: TARBALL, integrity: other }),
      ),
      LastReleaseError,
    );
  });

  it('refuses a tarball that is not on the registry', async () => {
    await rejects(
      fetchReleaseTarball(
        '@prisma/orm-a',
        '8.0.0-rc.3',
        options(async () => new Response(bytes), {
          tarball: 'https://example.com/orm-a.tgz',
          integrity,
        }),
      ),
      LastReleaseError,
    );
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
