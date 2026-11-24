import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requiredPeersForSetup, resolveRequiredPeers } from '../../src/orm/init-required-peers';
import {
  type PublishedPackage,
  REGISTRY_LOOKUP_TIMEOUT_MILLIS,
} from '../../src/orm/registry-keywords';

const VERSION = '8.1.0';
const never = new AbortController().signal;

const published = new Map<string, Record<string, string>>([
  [
    '@prisma/orm-mongo@latest',
    { '@prisma/orm-framework': VERSION, '@prisma/orm-family-mongo': VERSION, mongodb: '^7' },
  ],
  [`@prisma/orm-family-mongo@${VERSION}`, { '@prisma/orm-framework': VERSION }],
  [`@prisma/orm-framework@${VERSION}`, {}],
]);

let asked: string[];
let inFlight: number;
let mostInFlight: number;

async function readPublished(name: string, spec: string) {
  asked.push(`${name}@${spec}`);
  inFlight += 1;
  mostInFlight = Math.max(mostInFlight, inFlight);
  await new Promise((resolve) => setTimeout(resolve, 5));
  inFlight -= 1;
  const peers = published.get(`${name}@${spec}`);
  return peers === undefined
    ? undefined
    : {
        version: spec === 'latest' ? VERSION : spec,
        peerDependencies: peers,
        peerDependenciesMeta: undefined,
      };
}

// Outside the CLI's fixture app, whose own installed target packages would be found first.
let projectDir: string;

beforeEach(() => {
  asked = [];
  inFlight = 0;
  mostInFlight = 0;
  projectDir = mkdtempSync(join(tmpdir(), 'orm-init-prisma6-list-'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function installed(name: string, peers: Record<string, string>): void {
  const path = join(projectDir, 'node_modules', name, 'package.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ name, version: VERSION, peerDependencies: peers }));
}

function forSetup(
  read: (name: string, spec: string) => Promise<PublishedPackage | undefined> = readPublished,
) {
  return requiredPeersForSetup({
    cwd: projectDir,
    installedElsewhere: new Set(),
    signal: never,
    readPublished: read,
  });
}

describe('the list the printed Prisma 6 setup names', () => {
  it('reads the published manifests of a target package that is not installed, each level at once', async () => {
    const list = await forSetup()('@prisma/orm-mongo');

    expect({ list, asked, mostInFlight }).toEqual({
      list: {
        target: `@prisma/orm-mongo@${VERSION}`,
        packages: [
          { name: '@prisma/orm-family-mongo', version: VERSION, outcome: 'to-install' },
          { name: '@prisma/orm-framework', version: VERSION, outcome: 'to-install' },
          { name: 'mongodb', version: '^7', outcome: 'to-install' },
        ],
        unread: [],
        warnings: [],
      },
      asked: [
        '@prisma/orm-mongo@latest',
        `@prisma/orm-framework@${VERSION}`,
        `@prisma/orm-family-mongo@${VERSION}`,
      ],
      mostInFlight: 2,
    });
  });

  it('names a required peer that is not a Prisma ORM package, and leaves an optional one', async () => {
    const list = await forSetup(async (name, spec) =>
      name === '@prisma/orm-mongo'
        ? {
            version: VERSION,
            peerDependencies: {
              '@prisma/orm-framework': VERSION,
              'temporal-polyfill': '^1.0.8',
              typescript: '>=5.9',
            },
            peerDependenciesMeta: { typescript: { optional: true } },
          }
        : readPublished(name, spec),
    )('@prisma/orm-mongo');

    expect(list.packages).toEqual([
      { name: '@prisma/orm-framework', version: VERSION, outcome: 'to-install' },
      { name: 'temporal-polyfill', version: '^1.0.8', outcome: 'to-install' },
    ]);
  });

  it('reads the installed manifests first', async () => {
    installed('@prisma/orm-mongo', { '@prisma/orm-framework': VERSION });
    installed('@prisma/orm-framework', {});

    const list = await forSetup()('@prisma/orm-mongo');

    expect({ target: list.target, packages: list.packages.map((p) => p.name), asked }).toEqual({
      target: `@prisma/orm-mongo@${VERSION}`,
      packages: ['@prisma/orm-framework'],
      asked: [],
    });
  });

  it('names the target package alone, and says it could not read it, when the registry cannot be read', async () => {
    const list = await forSetup(async () => {
      throw new Error('ENOTFOUND registry.npmjs.org');
    })('@prisma/orm-mongo');

    expect(list).toEqual({
      target: '@prisma/orm-mongo',
      packages: [],
      unread: ['@prisma/orm-mongo'],
      warnings: [],
    });
  });

  it('says which package it could not read when a peer cannot be read', async () => {
    const list = await forSetup(async (name, spec) =>
      name === '@prisma/orm-family-mongo' ? undefined : readPublished(name, spec),
    )('@prisma/orm-mongo');

    expect(list.unread).toEqual(['@prisma/orm-family-mongo']);
  });
});

describe('the shared time limit and cancelling of the registry reads', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Answers after `delay` milliseconds, or rejects when its signal aborts. */
  function slowRead(delays: Readonly<Record<string, number>>) {
    return (name: string, spec: string, signal: AbortSignal) =>
      new Promise<Awaited<ReturnType<typeof readPublished>>>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        const delay = delays[name];
        if (delay === undefined) return;
        setTimeout(() => {
          const peers = published.get(`${name}@${spec}`);
          resolve(
            peers === undefined
              ? undefined
              : {
                  version: spec === 'latest' ? VERSION : spec,
                  peerDependencies: peers,
                  peerDependenciesMeta: undefined,
                },
          );
        }, delay);
      });
  }

  it('counts the time a read before took against the reads after it', async () => {
    vi.useFakeTimers();
    const firstRead = REGISTRY_LOOKUP_TIMEOUT_MILLIS * 0.6;
    const list = requiredPeersForSetup({
      cwd: projectDir,
      installedElsewhere: new Set(),
      signal: never,
      readPublished: slowRead({
        '@prisma/orm-mongo': firstRead,
        '@prisma/orm-framework': firstRead,
      }),
    })('@prisma/orm-mongo');

    await vi.advanceTimersByTimeAsync(REGISTRY_LOOKUP_TIMEOUT_MILLIS);

    await expect(list).resolves.toMatchObject({
      target: `@prisma/orm-mongo@${VERSION}`,
      unread: ['@prisma/orm-framework', '@prisma/orm-family-mongo'],
    });
  });

  it('passes the command being cancelled through instead of naming an unread package', async () => {
    const command = new AbortController();
    const list = requiredPeersForSetup({
      cwd: projectDir,
      installedElsewhere: new Set(),
      signal: command.signal,
      readPublished: slowRead({}),
    })('@prisma/orm-mongo');

    command.abort(new Error('cancelled'));

    await expect(list).rejects.toThrow('cancelled');
  });
});

describe('whether a package the project lists is at the version asked for', () => {
  const target = {
    version: VERSION,
    peers: new Map([['@prisma/orm-framework', VERSION]]),
  };

  function outcomeFor(line: string, installed: string | undefined) {
    return resolveRequiredPeers({
      packageName: '@prisma/orm-postgres',
      ownsTarget: false,
      installedElsewhere: new Set(),
      declared: () => new Map([['@prisma/orm-framework', line]]),
      installedVersion: () => installed,
      install: undefined,
      read: async (name) =>
        name === '@prisma/orm-postgres' ? target : { version: installed, peers: new Map() },
    });
  }

  it.each([
    ['the version, nothing installed', VERSION, undefined, 'already-listed'],
    ['a caret on the version, nothing installed', `^${VERSION}`, undefined, 'already-listed'],
    ['a catalog line, nothing installed', 'catalog:', undefined, 'already-listed'],
    ['another version, nothing installed', '8.0.0', undefined, 'left-at-another-version'],
    [
      'another version with the asked-for version installed',
      '8.0.0',
      VERSION,
      'left-at-another-version',
    ],
    [
      'a workspace line with another version installed',
      'workspace:*',
      '8.0.0',
      'left-at-another-version',
    ],
    ['a workspace line with the version installed', 'workspace:*', VERSION, 'already-listed'],
    [
      'a caret on an earlier version with the version installed',
      '^8.0.0',
      VERSION,
      'already-listed',
    ],
    ['a caret with another version installed', '^8.0.0', '8.0.0', 'left-at-another-version'],
    ['a tilde, nothing installed', '~8.0.0', undefined, 'already-listed'],
    ['a dist-tag with the version installed', 'latest', VERSION, 'already-listed'],
  ])('decides %s', async (_case, line, installed, outcome) => {
    expect(await outcomeFor(line, installed)).toMatchObject({
      packages: [{ name: '@prisma/orm-framework', version: VERSION, outcome }],
    });
  });

  it('counts a caret line init wrote for one release candidate once the next is installed and asked for', async () => {
    const resolved = await resolveRequiredPeers({
      packageName: '@prisma/orm-postgres',
      ownsTarget: false,
      installedElsewhere: new Set(),
      declared: () => new Map([['@prisma/orm-framework', '^8.0.0-rc.26']]),
      installedVersion: () => '8.0.0-rc.27',
      install: undefined,
      read: async () => ({
        version: '8.0.0-rc.27',
        peers: new Map([['@prisma/orm-framework', '8.0.0-rc.27']]),
      }),
    });

    expect(resolved).toMatchObject({
      packages: [
        { name: '@prisma/orm-framework', version: '8.0.0-rc.27', outcome: 'already-listed' },
      ],
      warnings: [],
    });
  });
});

describe('a package installed at a version other than the one asked for', () => {
  function installedAt(name: string, version: string, peers: Record<string, string>): void {
    const path = join(projectDir, 'node_modules', name, 'package.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ name, version, peerDependencies: peers }));
  }

  it('does not stand for the version asked for in the printed setup, and is not read from the registry', async () => {
    installedAt('@prisma/orm-framework', '8.0.0', { 'old-peer': '^1.0.0' });

    const list = await forSetup()('@prisma/orm-mongo');

    expect({
      packages: list.packages.map((peer) => peer.name),
      unread: list.unread,
      warnings: list.warnings,
      askedFramework: asked.filter((spec) => spec.startsWith('@prisma/orm-framework')),
    }).toEqual({
      packages: ['@prisma/orm-family-mongo', '@prisma/orm-framework', 'mongodb'],
      unread: [],
      warnings: [
        `@prisma/orm-framework is installed at 8.0.0, but @prisma/orm-mongo needs ${VERSION}, so init could not work out the packages @prisma/orm-framework needs as required peers. Once @prisma/orm-framework@${VERSION} is installed, add each package its package.json lists under peerDependencies, at the range listed there.`,
      ],
      askedFramework: [],
    });
  });

  it('is read again once init installs the version asked for, and what that version names is installed', async () => {
    const installs: (readonly string[])[] = [];
    let frameworkVersion = '8.0.0';
    const resolved = await resolveRequiredPeers({
      packageName: '@prisma/orm-postgres',
      ownsTarget: false,
      installedElsewhere: new Set(),
      declared: () => new Map(),
      installedVersion: () => undefined,
      install: async (specifiers) => {
        installs.push(specifiers);
        if (specifiers.includes(`@prisma/orm-framework@${VERSION}`)) frameworkVersion = VERSION;
        return undefined;
      },
      read: async (name) =>
        name === '@prisma/orm-postgres'
          ? { version: VERSION, peers: new Map([['@prisma/orm-framework', VERSION]]) }
          : {
              version: frameworkVersion,
              peers: new Map(
                frameworkVersion === VERSION
                  ? [['temporal-polyfill', '^1.0.8']]
                  : [['old-peer', '^1.0.0']],
              ),
            },
    });

    expect({ resolved, installs }).toEqual({
      resolved: {
        target: `@prisma/orm-postgres@${VERSION}`,
        packages: [
          { name: '@prisma/orm-framework', version: VERSION, outcome: 'installed' },
          { name: 'temporal-polyfill', version: '^1.0.8', outcome: 'installed' },
        ],
        unread: [],
        warnings: [],
      },
      installs: [[`@prisma/orm-framework@${VERSION}`], ['temporal-polyfill@^1.0.8']],
    });
  });
});

describe('the packages init installs in a round', () => {
  it('are read again, so a peer the installed version adds is installed too', async () => {
    const installs: (readonly string[])[] = [];
    let frameworkPeers = new Map<string, string>();
    const resolved = await resolveRequiredPeers({
      packageName: '@prisma/orm-postgres',
      ownsTarget: false,
      installedElsewhere: new Set(),
      declared: () => new Map(),
      installedVersion: () => undefined,
      install: async (specifiers) => {
        installs.push(specifiers);
        frameworkPeers = new Map([['temporal-polyfill', '^1.0.8']]);
        return undefined;
      },
      read: async (name) =>
        name === '@prisma/orm-postgres'
          ? { version: VERSION, peers: new Map([['@prisma/orm-framework', '~8.1.0']]) }
          : { version: VERSION, peers: frameworkPeers },
    });

    expect({
      packages: resolved instanceof Error ? resolved : resolved.packages,
      installs,
    }).toEqual({
      packages: [
        { name: '@prisma/orm-framework', version: '^8.1.0', outcome: 'installed' },
        { name: 'temporal-polyfill', version: '^1.0.8', outcome: 'installed' },
      ],
      installs: [['@prisma/orm-framework@^8.1.0'], ['temporal-polyfill@^1.0.8']],
    });
  });
});

describe('the lines init writes for each line of releases', () => {
  async function resolveFor(
    targetVersion: string,
    peers: Record<string, string>,
    declared: Record<string, string> = {},
  ) {
    const installs: (readonly string[])[] = [];
    const resolved = await resolveRequiredPeers({
      packageName: '@prisma/orm-mysql',
      ownsTarget: true,
      installedElsewhere: new Set(),
      declared: () => new Map(Object.entries(declared)),
      installedVersion: () => undefined,
      install: async (specifiers) => {
        installs.push(specifiers);
        return undefined;
      },
      read: async (name) =>
        name === '@prisma/orm-mysql'
          ? { version: targetVersion, peers: new Map(Object.entries(peers)) }
          : { version: undefined, peers: new Map() },
    });
    return { resolved, installs };
  }

  it('writes the exact versions on the release candidates', async () => {
    expect(
      await resolveFor('8.0.0-rc.27', {
        '@prisma/orm-framework': '8.0.0-rc.27',
        'temporal-polyfill': '^1.0.8',
      }),
    ).toEqual({
      resolved: {
        target: '@prisma/orm-mysql@8.0.0-rc.27',
        packages: [
          { name: '@prisma/orm-framework', version: '8.0.0-rc.27', outcome: 'installed' },
          { name: 'temporal-polyfill', version: '^1.0.8', outcome: 'installed' },
        ],
        unread: [],
        warnings: [],
      },
      installs: [
        [
          '@prisma/orm-mysql@8.0.0-rc.27',
          '@prisma/orm-framework@8.0.0-rc.27',
          'temporal-polyfill@^1.0.8',
        ],
      ],
    });
  });

  it('writes the exact versions for a development build', async () => {
    const { installs } = await resolveFor('8.1.0-dev.4', {
      '@prisma/orm-framework': '8.1.0-dev.4',
    });

    expect(installs).toEqual([
      ['@prisma/orm-mysql@8.1.0-dev.4', '@prisma/orm-framework@8.1.0-dev.4'],
    ]);
  });

  it('writes a caret on every line for a target package at a plain version', async () => {
    const { resolved, installs } = await resolveFor('8.1.2', {
      '@prisma/orm-framework': '~8.1.0',
      'temporal-polyfill': '^1.0.8',
    });

    expect({ resolved, installs }).toMatchObject({
      resolved: {
        target: '@prisma/orm-mysql@^8.1.0',
        packages: [
          { name: '@prisma/orm-framework', version: '^8.1.0', outcome: 'installed' },
          { name: 'temporal-polyfill', version: '^1.0.8', outcome: 'installed' },
        ],
      },
      installs: [
        ['@prisma/orm-mysql@^8.1.0', '@prisma/orm-framework@^8.1.0', 'temporal-polyfill@^1.0.8'],
      ],
    });
  });

  it('writes a tilde on every line for a target package at a pre-release', async () => {
    const { resolved, installs } = await resolveFor('8.1.0-ea.1', {
      '@prisma/orm-framework': '~8.1.0',
      '@prisma/orm-target-mysql': '~8.1.0-ea.0',
    });

    expect({ resolved, installs }).toMatchObject({
      resolved: {
        target: '@prisma/orm-mysql@~8.1.0-ea.1',
        packages: [
          { name: '@prisma/orm-framework', version: '~8.1.0', outcome: 'installed' },
          { name: '@prisma/orm-target-mysql', version: '~8.1.0-ea.0', outcome: 'installed' },
        ],
      },
      installs: [
        [
          '@prisma/orm-mysql@~8.1.0-ea.1',
          '@prisma/orm-framework@~8.1.0',
          '@prisma/orm-target-mysql@~8.1.0-ea.0',
        ],
      ],
    });
  });

  it('counts the line init would write as listed, and leaves the target line that already reads it', async () => {
    const { resolved, installs } = await resolveFor(
      '8.1.2',
      { '@prisma/orm-framework': '~8.1.0' },
      { '@prisma/orm-mysql': '^8.1.0', '@prisma/orm-framework': '^8.1.0' },
    );

    expect({ resolved, installs }).toMatchObject({
      resolved: {
        packages: [{ name: '@prisma/orm-framework', version: '^8.1.0', outcome: 'already-listed' }],
        warnings: [],
      },
      installs: [],
    });
  });
});

describe('a required version written with a v prefix', () => {
  it('stands for the same version listed and installed without it', async () => {
    const resolved = await resolveRequiredPeers({
      packageName: '@prisma/orm-postgres',
      ownsTarget: false,
      installedElsewhere: new Set(),
      declared: () => new Map([['@prisma/orm-framework', VERSION]]),
      installedVersion: () => VERSION,
      install: undefined,
      read: async (name) =>
        name === '@prisma/orm-postgres'
          ? { version: VERSION, peers: new Map([['@prisma/orm-framework', `v${VERSION}`]]) }
          : { version: VERSION, peers: new Map() },
    });

    expect(resolved).toMatchObject({
      packages: [{ name: '@prisma/orm-framework', outcome: 'already-listed' }],
      warnings: [],
    });
  });
});

describe('a required peer that is not a Prisma ORM package, listed at another exact version', () => {
  it('is left at that version with a warning that says to change the line', async () => {
    const resolved = await resolveRequiredPeers({
      packageName: '@prisma/orm-postgres',
      ownsTarget: false,
      installedElsewhere: new Set(),
      declared: () => new Map([['left-pad', '1.2.0']]),
      installedVersion: () => '1.2.0',
      install: async () => undefined,
      read: async () => ({
        version: VERSION,
        peers: new Map([
          ['@prisma/orm-framework', VERSION],
          ['left-pad', '1.3.0'],
        ]),
      }),
    });

    expect(resolved).toMatchObject({
      packages: expect.arrayContaining([
        { name: 'left-pad', version: '1.3.0', outcome: 'left-at-another-version' },
      ]),
      warnings: [
        'package.json lists left-pad at 1.2.0, installed at 1.2.0, but @prisma/orm-postgres needs 1.3.0; init left it as it is. Change the line to 1.3.0 and install.',
      ],
    });
  });
});
