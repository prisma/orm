import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { MountedTree, PackageManagerRunner } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createInitCommand } from '../../src/orm/init';
import { platformPackagesForSetup } from '../../src/orm/init-platform-packages';
import { type ImportFromProject, importFromProject } from '../../src/orm/project-modules';
import { declareAddedPackages } from '../utils/fake-package-manager';
import { fixtureContribution } from '../utils/fixture-contribution';
import { noRegistryLookup } from '../utils/registry-keywords';
import { createTestProjectDir } from '../utils/test-project-dir';

const VERSION = '8.1.0';

let projectDir: string;
let installs: (readonly string[])[];
let onInstall: (args: readonly string[]) => void;
let fails: (args: readonly string[]) => boolean;

const runner: PackageManagerRunner = async (request) => {
  installs.push([...request.args]);
  if (fails(request.args)) return { exitCode: 1, stderr: 'ETARGET no matching version' };
  declareAddedPackages(request);
  onInstall(request.args);
  return { exitCode: 0, stderr: '' };
};

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-platform-packages');
  installs = [];
  onInstall = () => {};
  fails = () => false;
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

async function harness(targetPackage: string) {
  const contribution = await fixtureContribution(targetPackage);
  const loadInit: ImportFromProject = async () => ({
    kind: 'loaded',
    module: { default: contribution },
  });
  const commands: MountedTree = {
    ...BIN_COMMANDS,
    'orm init': createInitCommand({
      emitScaffoldedContract: vi.fn().mockResolvedValue(undefined),
      importFromProject: (cwd, specifier) =>
        specifier.endsWith('/init') ? loadInit(cwd, specifier) : importFromProject(cwd, specifier),
      lookUpRegistryKeywords: noRegistryLookup,
    }),
  };
  return createTestCli({
    commands,
    groups: BIN_GROUPS,
    packageManagerRunner: runner,
    packageManager: 'pnpm',
  });
}

function writeProjectFile(relative: string, content: string): void {
  mkdirSync(join(projectDir, dirname(relative)), { recursive: true });
  writeFileSync(join(projectDir, relative), content, 'utf-8');
}

/** An installed package whose manifest names `peers`, each at `VERSION` unless given a range. */
function installed(name: string, peers: Record<string, string | undefined> = {}): void {
  const peerDependencies = Object.fromEntries(
    Object.entries(peers).map(([peer, range]) => [peer, range ?? VERSION]),
  );
  writeProjectFile(
    `node_modules/${name}/package.json`,
    JSON.stringify({ name, version: VERSION, peerDependencies }),
  );
}

function writeManifest(dependencies: Record<string, string>): void {
  writeProjectFile(
    'package.json',
    JSON.stringify({ name: 'app', private: true, type: 'module', dependencies }),
  );
}

function declared(): Record<string, string> {
  return JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8')).dependencies;
}

function installedPostgresStack(): void {
  installed('@prisma/orm-postgres', {
    '@prisma/orm-framework': undefined,
    '@prisma/orm-toolchain': undefined,
    '@prisma/orm-family-sql': undefined,
    '@prisma/orm-target-postgres': undefined,
    pg: '^8.22.0',
  });
  installed('@prisma/orm-framework');
  installed('@prisma/orm-toolchain', { '@prisma/orm-framework': undefined });
  installed('@prisma/orm-family-sql', {
    '@prisma/orm-framework': undefined,
    '@prisma/orm-toolchain': undefined,
  });
  installed('@prisma/orm-target-postgres', {
    '@prisma/orm-family-sql': undefined,
    '@prisma/orm-framework': undefined,
    '@prisma/orm-toolchain': undefined,
  });
}

const POSTGRES_STACK = [
  `@prisma/orm-postgres@${VERSION}`,
  `@prisma/orm-family-sql@${VERSION}`,
  `@prisma/orm-framework@${VERSION}`,
  `@prisma/orm-target-postgres@${VERSION}`,
  `@prisma/orm-toolchain@${VERSION}`,
];

function runtimeInstalls(): (readonly string[])[] {
  return installs.filter((args) => args[0] === 'add' && !args.includes('-D'));
}

const POSTGRES = ['orm', 'init', '--target', 'postgres', '--authoring', 'psl', '--json'];
const MONGO = ['orm', 'init', '--target', 'mongodb', '--authoring', 'psl', '--json'];

describe('init lists the packages the target package names as peers', () => {
  it(
    'installs the PostgreSQL platform packages at the version of the installed package',
    async () => {
      installedPostgresStack();

      const run = await (await harness('@prisma/orm-postgres')).run(POSTGRES, {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(0);
      expect(runtimeInstalls()).toEqual([
        ['add', '@prisma/orm-postgres', 'dotenv', 'pg'],
        ['add', ...POSTGRES_STACK],
      ]);
      expect(run.presented?.data).toMatchObject({
        packagesInstalled: { status: 'installed', deps: [...POSTGRES_STACK, 'dotenv', 'pg'] },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'installs the MongoDB platform packages at the version of the installed package',
    async () => {
      installed('@prisma/orm-mongo', {
        '@prisma/orm-framework': undefined,
        '@prisma/orm-toolchain': undefined,
        '@prisma/orm-family-mongo': undefined,
        '@prisma/orm-target-mongo': undefined,
        mongodb: '^7.4.0',
      });
      installed('@prisma/orm-framework');
      installed('@prisma/orm-toolchain', { '@prisma/orm-framework': undefined });
      installed('@prisma/orm-family-mongo', {
        '@prisma/orm-framework': undefined,
        '@prisma/orm-toolchain': undefined,
      });
      installed('@prisma/orm-target-mongo', {
        '@prisma/orm-family-mongo': undefined,
        '@prisma/orm-framework': undefined,
        '@prisma/orm-toolchain': undefined,
      });

      const run = await (await harness('@prisma/orm-mongo')).run(MONGO, { cwd: projectDir });

      expect(run.exitCode).toBe(0);
      expect(runtimeInstalls()).toEqual([
        ['add', '@prisma/orm-mongo', 'dotenv', 'mongodb'],
        [
          'add',
          `@prisma/orm-mongo@${VERSION}`,
          `@prisma/orm-family-mongo@${VERSION}`,
          `@prisma/orm-framework@${VERSION}`,
          `@prisma/orm-target-mongo@${VERSION}`,
          `@prisma/orm-toolchain@${VERSION}`,
        ],
      ]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'follows peers of peers until no new name appears',
    async () => {
      installed('@prisma/orm-postgres', { '@prisma/orm-alpha': undefined, pg: '^8.22.0' });
      installed('@prisma/orm-alpha', { '@prisma/orm-beta': undefined });
      installed('@prisma/orm-beta', {
        '@prisma/orm-gamma': undefined,
        '@prisma/orm-alpha': undefined,
      });
      installed('@prisma/orm-gamma');

      const run = await (await harness('@prisma/orm-postgres')).run(POSTGRES, {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(0);
      expect(runtimeInstalls()).toEqual([
        ['add', '@prisma/orm-postgres', 'dotenv', 'pg'],
        [
          'add',
          `@prisma/orm-postgres@${VERSION}`,
          `@prisma/orm-alpha@${VERSION}`,
          `@prisma/orm-beta@${VERSION}`,
          `@prisma/orm-gamma@${VERSION}`,
        ],
      ]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'reads a peer that the package manager puts on disk only when init installs it',
    async () => {
      installed('@prisma/orm-postgres', { '@prisma/orm-alpha': undefined, pg: '^8.22.0' });
      onInstall = (args) => {
        if (args.includes(`@prisma/orm-alpha@${VERSION}`)) {
          installed('@prisma/orm-alpha', { '@prisma/orm-beta': undefined });
        }
        if (args.includes(`@prisma/orm-beta@${VERSION}`)) installed('@prisma/orm-beta');
      };

      const run = await (await harness('@prisma/orm-postgres')).run(POSTGRES, {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(0);
      expect(runtimeInstalls()).toEqual([
        ['add', '@prisma/orm-postgres', 'dotenv', 'pg'],
        ['add', `@prisma/orm-postgres@${VERSION}`, `@prisma/orm-alpha@${VERSION}`],
        ['add', `@prisma/orm-beta@${VERSION}`],
      ]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'prints the same list under --skip-install',
    async () => {
      installedPostgresStack();
      writeManifest({ '@prisma/orm-postgres': VERSION });

      const run = await (await harness('@prisma/orm-postgres')).run(
        [...POSTGRES, '--skip-install'],
        {
          cwd: projectDir,
        },
      );

      expect(run.exitCode).toBe(0);
      expect(installs).toEqual([]);
      expect(JSON.stringify(run.json)).toContain(
        `Install the project dependencies with your package manager: ${[...POSTGRES_STACK, 'dotenv', 'pg'].join(', ')}`,
      );
    },
    timeouts.coldTransformImport,
  );

  it(
    'leaves a platform package the project lists at another version, and reports it',
    async () => {
      installedPostgresStack();
      writeManifest({ '@prisma/orm-framework': '8.0.0' });

      const run = await (await harness('@prisma/orm-postgres')).run(POSTGRES, {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(0);
      expect(runtimeInstalls()[1]).toEqual(
        ['add', ...POSTGRES_STACK].filter((arg) => !arg.startsWith('@prisma/orm-framework@')),
      );
      expect(declared()['@prisma/orm-framework']).toBe('8.0.0');
      expect(run.presented?.data).toMatchObject({
        warnings: expect.arrayContaining([
          `package.json lists @prisma/orm-framework at 8.0.0, but @prisma/orm-postgres needs ${VERSION}; init left it as it is. Install @prisma/orm-framework@${VERSION} so every Prisma ORM package is at one version.`,
        ]),
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'adds nothing on a second run when every package is listed at its version',
    async () => {
      installedPostgresStack();
      writeManifest({
        ...Object.fromEntries(
          POSTGRES_STACK.map((spec) => [spec.slice(0, spec.lastIndexOf('@')), VERSION]),
        ),
        dotenv: '^17.4.2',
        pg: '^8.22.0',
      });

      const run = await (await harness('@prisma/orm-postgres')).run(POSTGRES, { cwd: projectDir });

      expect(run.exitCode).toBe(0);
      expect(
        runtimeInstalls()
          .flat()
          .filter((arg) => arg.startsWith('@prisma/orm-')),
      ).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'installs only what it installs today for a target package that names no Prisma ORM peer',
    async () => {
      installed('@prisma/orm-postgres', { pg: '^8.22.0' });

      const run = await (await harness('@prisma/orm-postgres')).run(POSTGRES, {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(0);
      expect(runtimeInstalls()).toEqual([['add', '@prisma/orm-postgres', 'dotenv', 'pg']]);
      expect(run.presented?.data).toMatchObject({
        packagesInstalled: { deps: ['@prisma/orm-postgres', 'dotenv', 'pg'] },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'says how to remove what it installed when installing a platform package fails',
    async () => {
      installedPostgresStack();
      fails = (args) => args.includes(`@prisma/orm-framework@${VERSION}`);

      const run = await (await harness('@prisma/orm-postgres')).run(POSTGRES, {
        cwd: projectDir,
      });

      const terminal = run.json.at(-1);
      expect(terminal === undefined ? undefined : Reflect.get(terminal, 'envelope')).toMatchObject({
        ok: false,
        error: {
          meta: expect.objectContaining({
            packagesAdded: ['@prisma/orm-postgres', 'dotenv', 'pg'],
          }),
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label:
                'init installed @prisma/orm-postgres, dotenv and pg to read the init contribution of @prisma/orm-postgres; remove them with `pnpm remove @prisma/orm-postgres dotenv pg`.',
            }),
          ]),
        },
      });
    },
    timeouts.coldTransformImport,
  );
});

describe('the list the printed Prisma 6 setup names', () => {
  const published = new Map<string, Record<string, string>>([
    [
      '@prisma/orm-mongo@latest',
      { '@prisma/orm-framework': VERSION, '@prisma/orm-family-mongo': VERSION, mongodb: '^7' },
    ],
    [`@prisma/orm-family-mongo@${VERSION}`, { '@prisma/orm-framework': VERSION }],
    [`@prisma/orm-framework@${VERSION}`, {}],
  ]);
  const asked: string[] = [];
  const readPublished = async (name: string, spec: string) => {
    asked.push(`${name}@${spec}`);
    const peers = published.get(`${name}@${spec}`);
    return peers === undefined
      ? undefined
      : { version: spec === 'latest' ? VERSION : spec, peerDependencies: peers };
  };

  // Outside the fixture app, whose own installed target packages would be found first.
  let outsideDir: string;

  beforeEach(() => {
    asked.length = 0;
    outsideDir = mkdtempSync(join(tmpdir(), 'orm-init-prisma6-list-'));
  });

  afterEach(() => {
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('reads the published manifests of a database package that is not installed', async () => {
    const list = await platformPackagesForSetup({ cwd: outsideDir, readPublished })(
      '@prisma/orm-mongo',
    );

    expect({ list, asked }).toEqual({
      list: [
        `@prisma/orm-mongo@${VERSION}`,
        `@prisma/orm-family-mongo@${VERSION}`,
        `@prisma/orm-framework@${VERSION}`,
      ],
      asked: [
        '@prisma/orm-mongo@latest',
        `@prisma/orm-framework@${VERSION}`,
        `@prisma/orm-family-mongo@${VERSION}`,
      ],
    });
  });

  it('reads the installed manifests first', async () => {
    installed('@prisma/orm-mongo', { '@prisma/orm-framework': undefined });
    installed('@prisma/orm-framework');

    const list = await platformPackagesForSetup({ cwd: projectDir, readPublished })(
      '@prisma/orm-mongo',
    );

    expect({ list, asked }).toEqual({
      list: [`@prisma/orm-mongo@${VERSION}`, `@prisma/orm-framework@${VERSION}`],
      asked: [],
    });
  });

  it('names only the database package when the registry cannot be read', async () => {
    const list = await platformPackagesForSetup({
      cwd: outsideDir,
      readPublished: async () => undefined,
    })('@prisma/orm-mongo');

    expect(list).toEqual(['@prisma/orm-mongo']);
  });
});
