import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ormPeerPackagesForSetup } from '../../src/orm/init-orm-peer-packages';

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
    : { version: spec === 'latest' ? VERSION : spec, peerDependencies: peers };
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

function forSetup(read = readPublished) {
  return ormPeerPackagesForSetup({ cwd: projectDir, signal: never, readPublished: read });
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
