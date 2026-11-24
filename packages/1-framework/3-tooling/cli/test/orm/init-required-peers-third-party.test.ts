import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { MountedTree, PackageManagerRunner } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createInitCommand } from '../../src/orm/init';
import {
  type ImportFromProject,
  importFromProject,
  type ProjectImport,
} from '../../src/orm/project-modules';
import { declareAddedPackages } from '../utils/fake-package-manager';
import { fixtureContribution } from '../utils/fixture-contribution';
import { noRegistryLookup, noRegistryPeersLookup } from '../utils/registry-keywords';
import { createTestProjectDir } from '../utils/test-project-dir';

const VERSION = '8.1.0';
const POSTGRES = ['orm', 'init', '--target', 'postgres', '--authoring', 'psl', '--json'];

let projectDir: string;
let installs: (readonly string[])[];
let initLoads: number;

const runner: PackageManagerRunner = async (request) => {
  installs.push([...request.args]);
  declareAddedPackages(request);
  return { exitCode: 0, stderr: '' };
};

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-required-peers-third-party');
  installs = [];
  initLoads = 0;
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

async function harness(loaded?: ProjectImport) {
  const contribution = await fixtureContribution('@prisma/orm-postgres');
  const loadInit: ImportFromProject = async () => {
    initLoads += 1;
    return loaded ?? { kind: 'loaded', module: { default: contribution } };
  };
  const commands: MountedTree = {
    ...BIN_COMMANDS,
    'orm init': createInitCommand({
      emitScaffoldedContract: vi.fn().mockResolvedValue(undefined),
      importFromProject: (cwd, specifier) =>
        specifier.endsWith('/init') ? loadInit(cwd, specifier) : importFromProject(cwd, specifier),
      lookUpRegistryKeywords: noRegistryLookup,
      lookUpRegistryPeers: noRegistryPeersLookup,
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

function installed(
  name: string,
  peerDependencies: Record<string, string> = {},
  peerDependenciesMeta: Record<string, { optional: boolean }> = {},
): void {
  writeProjectFile(
    `node_modules/${name}/package.json`,
    JSON.stringify({ name, version: VERSION, peerDependencies, peerDependenciesMeta }),
  );
}

function writeManifest(dependencies: Record<string, string>): void {
  writeProjectFile(
    'package.json',
    JSON.stringify({ name: 'app', private: true, type: 'module', dependencies }),
  );
}

/** A target package with the peers `@prisma/orm-postgres` has: platform packages, the driver, `temporal-polyfill`, and an optional `typescript`. */
function installedTarget(): void {
  installed(
    '@prisma/orm-postgres',
    {
      '@prisma/orm-framework': VERSION,
      '@prisma/orm-toolchain': VERSION,
      pg: '^8.22.0',
      'temporal-polyfill': '^1.0.8',
      typescript: '>=5.9',
    },
    { typescript: { optional: true } },
  );
  installed('@prisma/orm-framework', { 'temporal-polyfill': '^1.0.8' });
  installed('@prisma/orm-toolchain', {
    '@prisma/orm-framework': VERSION,
    '@prisma/cli-engine': '0.10.4',
  });
}

function runtimeInstalls(): (readonly string[])[] {
  return installs.filter((args) => args[0] === 'add' && !args.includes('-D'));
}

function envelopeOf(run: { readonly json: readonly { readonly kind: string }[] }) {
  const terminal = run.json.at(-1);
  return terminal !== undefined && terminal.kind === 'result'
    ? Reflect.get(terminal, 'envelope')
    : undefined;
}

describe('init adds the required peers that are not Prisma ORM packages', () => {
  it(
    'adds a required peer once, leaves an optional one, and adds neither the driver nor the engine twice',
    async () => {
      installedTarget();

      const run = await (await harness()).run(POSTGRES, { cwd: projectDir });

      expect(run.exitCode).toBe(0);
      expect(runtimeInstalls()).toEqual([
        ['add', '@prisma/orm-postgres', 'dotenv', 'pg'],
        [
          'add',
          `@prisma/orm-postgres@${VERSION}`,
          `@prisma/orm-framework@${VERSION}`,
          `@prisma/orm-toolchain@${VERSION}`,
          'temporal-polyfill@^1.0.8',
        ],
      ]);
      expect(
        installs.flat().filter((arg) => arg === 'pg' || arg.startsWith('@prisma/cli-engine')),
      ).toEqual(['pg', '@prisma/cli-engine@latest']);
      expect(run.presented?.data).toMatchObject({
        packagesInstalled: {
          requiredPeers: [
            { name: '@prisma/orm-framework', version: VERSION, outcome: 'installed' },
            { name: '@prisma/orm-toolchain', version: VERSION, outcome: 'installed' },
            { name: 'pg', version: '^8.22.0', outcome: 'already-listed' },
            { name: 'temporal-polyfill', version: '^1.0.8', outcome: 'installed' },
          ],
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'leaves a required peer the project already lists',
    async () => {
      installedTarget();
      writeManifest({ 'temporal-polyfill': '^1.0.0' });

      const run = await (await harness()).run(POSTGRES, { cwd: projectDir });

      expect(runtimeInstalls().flat()).not.toContain('temporal-polyfill@^1.0.8');
      expect(run.presented?.data).toMatchObject({
        warnings: expect.not.arrayContaining([expect.stringContaining('temporal-polyfill')]),
        packagesInstalled: {
          requiredPeers: expect.arrayContaining([
            { name: 'temporal-polyfill', version: '^1.0.8', outcome: 'already-listed' },
          ]),
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'stops under --skip-install, before loading the init entrypoint, when a required peer is not installed',
    async () => {
      installedTarget();
      installed('pg');
      writeManifest({ '@prisma/orm-postgres': VERSION });

      const run = await (await harness()).run([...POSTGRES, '--skip-install'], {
        cwd: projectDir,
      });

      expect(initLoads).toBe(0);
      expect(installs).toEqual([]);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_REQUIRED_PEERS_NOT_INSTALLED',
          meta: {
            packageName: '@prisma/orm-postgres',
            missing: ['temporal-polyfill'],
            installCommand: 'pnpm add "temporal-polyfill@^1.0.8"',
          },
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label: expect.stringContaining(
                'pnpm add "temporal-polyfill@^1.0.8"`, then run `prisma orm init` again',
              ),
            }),
          ]),
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'says to run the install, not to add it, for a required peer the project lists but has not installed',
    async () => {
      installedTarget();
      installed('pg');
      writeManifest({ '@prisma/orm-postgres': VERSION, 'temporal-polyfill': 'catalog:' });

      const run = await (await harness()).run([...POSTGRES, '--skip-install'], {
        cwd: projectDir,
      });

      expect(initLoads).toBe(0);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_REQUIRED_PEERS_NOT_INSTALLED',
          meta: {
            missing: ['temporal-polyfill'],
            listedMissing: ['temporal-polyfill'],
            restoreCommand: 'pnpm install',
          },
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label:
                'Run `pnpm install` to install temporal-polyfill, which package.json already lists, then run `prisma orm init` again.',
            }),
          ]),
        },
      });
      expect(JSON.stringify(envelopeOf(run))).not.toContain('pnpm add');
    },
    timeouts.coldTransformImport,
  );

  it(
    'says to run the install for a listed missing peer and to add an unlisted one',
    async () => {
      installedTarget();
      installed('@prisma/orm-postgres', {
        '@prisma/orm-framework': VERSION,
        'temporal-polyfill': '^1.0.8',
        'left-pad': '^1.3.0',
      });
      writeManifest({ '@prisma/orm-postgres': VERSION, 'temporal-polyfill': 'catalog:' });

      const run = await (await harness()).run([...POSTGRES, '--skip-install'], {
        cwd: projectDir,
      });

      expect(envelopeOf(run)).toMatchObject({
        error: {
          code: 'CLI.INIT_REQUIRED_PEERS_NOT_INSTALLED',
          meta: {
            listedMissing: ['temporal-polyfill'],
            installCommand: 'pnpm add "left-pad@^1.3.0"',
          },
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label:
                'Run `pnpm install` to install temporal-polyfill, which package.json already lists, and add the others with `pnpm add "left-pad@^1.3.0"`, then run `prisma orm init` again.',
            }),
          ]),
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'says which required peers are missing when the init entrypoint cannot be loaded',
    async () => {
      installedTarget();
      installed('pg');
      const run = await (
        await harness({
          kind: 'unloadable',
          cause: new Error("Cannot find package 'temporal-polyfill'"),
        })
      ).run(POSTGRES, { cwd: projectDir });

      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_CONTRIBUTION_UNAVAILABLE',
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label: expect.stringContaining(
                'temporal-polyfill, which @prisma/orm-postgres needs as a peer, is not installed',
              ),
            }),
          ]),
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'goes on under --skip-install when the required peers sit beside the target package, as pnpm installs them',
    async () => {
      const real = 'node_modules/.pnpm/@prisma+orm-postgres@8.1.0/node_modules';
      writeProjectFile(
        `${real}/@prisma/orm-postgres/package.json`,
        JSON.stringify({
          name: '@prisma/orm-postgres',
          version: VERSION,
          peerDependencies: {
            '@prisma/orm-framework': VERSION,
            pg: '^8.22.0',
            'temporal-polyfill': '^1.0.8',
          },
        }),
      );
      writeProjectFile(
        `${real}/@prisma/orm-framework/package.json`,
        JSON.stringify({ name: '@prisma/orm-framework', version: VERSION }),
      );
      writeProjectFile(
        `${real}/temporal-polyfill/package.json`,
        JSON.stringify({ name: 'temporal-polyfill', version: '1.0.8' }),
      );
      mkdirSync(join(projectDir, 'node_modules', '@prisma'), { recursive: true });
      symlinkSync(
        join(projectDir, real, '@prisma', 'orm-postgres'),
        join(projectDir, 'node_modules', '@prisma', 'orm-postgres'),
        'dir',
      );
      writeManifest({ '@prisma/orm-postgres': VERSION, pg: '^8.22.0' });

      const run = await (await harness()).run([...POSTGRES, '--skip-install'], {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(0);
      expect(initLoads).toBe(1);
      expect(JSON.stringify(run.json)).toContain(
        `Install the project dependencies with your package manager: @prisma/orm-postgres@${VERSION}, @prisma/orm-framework@${VERSION}, dotenv, pg, \\"temporal-polyfill@^1.0.8\\"`,
      );
    },
    timeouts.coldTransformImport,
  );
});

describe('init --skip-install with a required peer installed at another version', () => {
  function frameworkInstalledAt(version: string): void {
    writeProjectFile(
      'node_modules/@prisma/orm-framework/package.json',
      JSON.stringify({ name: '@prisma/orm-framework', version, peerDependencies: {} }),
    );
  }

  async function skipInstall() {
    installedTarget();
    installed('pg');
    installed('temporal-polyfill');
    frameworkInstalledAt('8.0.0');
    const run = await (await harness()).run([...POSTGRES, '--skip-install'], { cwd: projectDir });
    return { run, wrote: existsSync(join(projectDir, 'prisma.config.ts')) };
  }

  it(
    'stops before writing any file and names the add command for a package the project does not list',
    async () => {
      writeManifest({
        '@prisma/orm-postgres': VERSION,
        'temporal-polyfill': '^1.0.8',
        pg: '^8.22.0',
      });

      const { run, wrote } = await skipInstall();

      expect({ wrote, initLoads, installs }).toEqual({ wrote: false, initLoads: 0, installs: [] });
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_REQUIRED_PEERS_AT_ANOTHER_VERSION',
          meta: {
            packageName: '@prisma/orm-postgres',
            packages: [{ name: '@prisma/orm-framework', found: '8.0.0', required: VERSION }],
            installCommand: `pnpm add @prisma/orm-framework@${VERSION}`,
          },
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label: `Add them with \`pnpm add @prisma/orm-framework@${VERSION}\`, then run \`prisma orm init\` again.`,
            }),
          ]),
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'says to run the install for a package the project lists at the required version',
    async () => {
      writeManifest({
        '@prisma/orm-postgres': VERSION,
        '@prisma/orm-framework': VERSION,
        'temporal-polyfill': '^1.0.8',
        pg: '^8.22.0',
      });

      const { run, wrote } = await skipInstall();

      expect(wrote).toBe(false);
      expect(envelopeOf(run)).toMatchObject({
        error: {
          code: 'CLI.INIT_REQUIRED_PEERS_AT_ANOTHER_VERSION',
          meta: { restoreCommand: 'pnpm install' },
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label:
                'Run `pnpm install` to install @prisma/orm-framework at the version package.json lists, then run `prisma orm init` again.',
            }),
          ]),
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'says to change the line for a package the project lists at another version',
    async () => {
      writeManifest({
        '@prisma/orm-postgres': VERSION,
        '@prisma/orm-framework': '8.0.0',
        'temporal-polyfill': '^1.0.8',
        pg: '^8.22.0',
      });

      const { run, wrote } = await skipInstall();

      expect(wrote).toBe(false);
      expect(envelopeOf(run)).toMatchObject({
        error: {
          code: 'CLI.INIT_REQUIRED_PEERS_AT_ANOTHER_VERSION',
          meta: {
            packages: [
              { name: '@prisma/orm-framework', found: '8.0.0', required: VERSION, listed: '8.0.0' },
            ],
          },
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label: `Change the line for @prisma/orm-framework in package.json from 8.0.0 to ${VERSION} and run \`pnpm install\`, then run \`prisma orm init\` again.`,
            }),
          ]),
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'says to change the version a catalog line points to, not to replace the line',
    async () => {
      writeManifest({
        '@prisma/orm-postgres': VERSION,
        '@prisma/orm-framework': 'catalog:',
        'temporal-polyfill': '^1.0.8',
        pg: '^8.22.0',
      });

      const { run, wrote } = await skipInstall();

      expect(wrote).toBe(false);
      expect(envelopeOf(run)).toMatchObject({
        error: {
          code: 'CLI.INIT_REQUIRED_PEERS_AT_ANOTHER_VERSION',
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label: `Make the line for @prisma/orm-framework in package.json resolve to ${VERSION} (it is \`catalog:\` now, so change the version where it points, such as the catalog entry or the workspace package) and run \`pnpm install\`, then run \`prisma orm init\` again.`,
            }),
          ]),
        },
      });
    },
    timeouts.coldTransformImport,
  );
});

describe('init --skip-install on a target package that names its peers with ranges', () => {
  function manifestAt(name: string, version: string, peerDependencies: Record<string, string>) {
    writeProjectFile(
      `node_modules/${name}/package.json`,
      JSON.stringify({ name, version, peerDependencies }),
    );
  }

  async function skipInstallWithFrameworkAt(frameworkVersion: string) {
    manifestAt('@prisma/orm-postgres', '8.1.2', {
      '@prisma/orm-framework': '~8.1.0',
      '@prisma/orm-toolchain': '~8.1.0',
      pg: '^8.22.0',
      'temporal-polyfill': '^1.0.8',
    });
    manifestAt('@prisma/orm-toolchain', '8.1.2', { '@prisma/orm-framework': '~8.1.0' });
    manifestAt('@prisma/orm-framework', frameworkVersion, {});
    installed('pg');
    installed('temporal-polyfill');
    writeManifest({
      '@prisma/orm-postgres': '^8.1.0',
      '@prisma/orm-toolchain': '^8.1.0',
      'temporal-polyfill': '^1.0.8',
      pg: '^8.22.0',
    });
    const run = await (await harness()).run([...POSTGRES, '--skip-install'], { cwd: projectDir });
    return { run, wrote: existsSync(join(projectDir, 'prisma.config.ts')) };
  }

  it(
    'stops before writing any file when a required peer is of another release',
    async () => {
      const { run, wrote } = await skipInstallWithFrameworkAt('8.0.4');

      expect(wrote).toBe(false);
      expect(envelopeOf(run)).toMatchObject({
        error: {
          code: 'CLI.INIT_REQUIRED_PEERS_AT_ANOTHER_VERSION',
          meta: {
            packages: [{ name: '@prisma/orm-framework', found: '8.0.4', required: '^8.1.0' }],
            installCommand: 'pnpm add "@prisma/orm-framework@^8.1.0"',
          },
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'goes on when the required peer is a later patch of the same release',
    async () => {
      const { run, wrote } = await skipInstallWithFrameworkAt('8.1.5');

      expect({ wrote, code: Reflect.get(envelopeOf(run)?.error ?? {}, 'code') }).toEqual({
        wrote: true,
        code: undefined,
      });
    },
    timeouts.coldTransformImport,
  );
});
