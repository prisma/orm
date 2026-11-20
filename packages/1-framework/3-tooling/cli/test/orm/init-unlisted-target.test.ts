import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { MountedTree, PackageManagerRunner } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts } from '@repo/test-utils';
import { basename, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configFile } from '../../src/commands/init/templates/code-templates';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createInitCommand } from '../../src/orm/init';
import { type ImportFromProject, importFromProject } from '../../src/orm/project-modules';
import {
  type LookUpRegistryKeywords,
  type RegistryLookup,
  lookUpRegistryKeywords as realRegistryLookup,
} from '../../src/orm/registry-keywords';
import { declareAddedPackages } from '../utils/fake-package-manager';
import { fixtureContribution } from '../utils/fixture-contribution';
import { createTestProjectDir } from '../utils/test-project-dir';

const UNLISTED = 'prisma-orm-somedb';
const NO_INIT = 'prisma-orm-noinit';

let projectDir: string;
let installs: (readonly string[])[];
let loaded: string[];
let installsFail: boolean;
let lookups: string[];
let registryAnswer: RegistryLookup;

const REGISTRY = 'https://registry.example.test';
const KEYWORD = 'prisma-orm-extension';

const fakeRegistryLookup: LookUpRegistryKeywords = async (packageName) => {
  lookups.push(packageName);
  return registryAnswer;
};

const runner: PackageManagerRunner = async (request) => {
  installs.push([...request.args]);
  if (installsFail) {
    return { exitCode: 1, stderr: 'ERR_PNPM_FETCH_404 Not Found' };
  }
  declareAddedPackages(request);
  return { exitCode: 0, stderr: '' };
};

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-unlisted-target');
  installs = [];
  loaded = [];
  installsFail = false;
  lookups = [];
  registryAnswer = { kind: 'read', registry: REGISTRY, keywords: ['database', KEYWORD] };
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(projectDir, { recursive: true, force: true });
});

/** An unlisted package whose contribution names its own driver; listed packages load as installed. */
async function unlistedPackage(packageName = UNLISTED): Promise<ImportFromProject> {
  const contribution = {
    ...(await fixtureContribution('@prisma/orm-postgres')),
    label: 'SomeDB',
    peerPackages: ['somedb-driver'],
  };
  return async (cwd, specifier) => {
    if (specifier.endsWith('/init')) loaded.push(specifier);
    return specifier === `${packageName}/init`
      ? { kind: 'loaded', module: { default: contribution } }
      : importFromProject(cwd, specifier);
  };
}

function harness(
  loadModule: ImportFromProject = importFromProject,
  lookUpRegistryKeywords: LookUpRegistryKeywords = fakeRegistryLookup,
) {
  const commands: MountedTree = {
    ...BIN_COMMANDS,
    'orm init': createInitCommand({
      emitScaffoldedContract: vi.fn().mockResolvedValue(undefined),
      importFromProject: loadModule,
      lookUpRegistryKeywords,
    }),
  };
  return createTestCli({
    commands,
    groups: BIN_GROUPS,
    packageManagerRunner: runner,
    packageManager: 'pnpm',
  });
}

function envelopeOf(run: { readonly json: readonly { readonly kind: string }[] }) {
  const terminal = run.json.at(-1);
  return terminal !== undefined && terminal.kind === 'result'
    ? Reflect.get(terminal, 'envelope')
    : undefined;
}

function writeProjectFile(relative: string, content: string): void {
  mkdirSync(join(projectDir, relative, '..'), { recursive: true });
  writeFileSync(join(projectDir, relative), content);
}

function readProjectFile(relative: string): string {
  return readFileSync(join(projectDir, relative), 'utf-8');
}

/** A package of that name exists on the registry and installs, but exports no `./init`. */
function packageWithoutInit(packageName: string): ImportFromProject {
  return async (cwd, specifier) => {
    if (specifier.endsWith('/init')) loaded.push(specifier);
    return specifier === `${packageName}/init`
      ? { kind: 'not-exported' }
      : importFromProject(cwd, specifier);
  };
}

function projectEntries(): string[] {
  return readdirSync(projectDir).filter((entry) => entry !== 'node_modules');
}

const starter = (target: string) => [
  'orm',
  'init',
  '--target',
  target,
  '--authoring',
  'psl',
  '--json',
];

describe('init with a target package that is in no list', () => {
  it(
    'installs the package and dotenv first, and the drivers its contribution names later',
    async () => {
      const run = await harness(await unlistedPackage()).run(starter(UNLISTED), {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(0);
      expect(loaded).toEqual([`${UNLISTED}/init`]);
      expect(installs[0]).toEqual(['add', UNLISTED, 'dotenv']);
      expect(installs[1]).toEqual(['add', 'somedb-driver']);
      expect(run.presented?.data).toMatchObject({
        target: UNLISTED,
        package: UNLISTED,
        packagesInstalled: {
          status: 'installed',
          deps: [UNLISTED, 'dotenv', 'somedb-driver'],
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'offers another package name in the picker, and runs as --target with that name does',
    async () => {
      const run = await harness(await unlistedPackage()).run(['orm', 'init', '--json'], {
        cwd: projectDir,
        isTty: { stdin: true },
        answers: ['another-package', ` ${UNLISTED} `, 'psl', 'src/prisma/contract.prisma', false],
      });

      expect(run.exitCode).toBe(0);
      expect(installs[0]).toEqual(['add', UNLISTED, 'dotenv']);
      expect(installs[1]).toEqual(['add', 'somedb-driver']);
      expect(run.presented?.data).toMatchObject({ target: UNLISTED, package: UNLISTED });
    },
    timeouts.coldTransformImport,
  );

  it(
    'refuses a value that is neither a known name nor a valid package name, before anything changes',
    async () => {
      const run = await harness(await unlistedPackage()).run(starter('Not A Package!'), {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_INVALID_FLAG_VALUE',
          meta: {
            flag: 'target',
            value: 'Not A Package!',
            allowed: ['postgres', 'mongodb'],
            acceptsPackageName: true,
            problems: expect.arrayContaining(['name can only contain URL-friendly characters']),
          },
        },
      });
      expect(installs).toEqual([]);
      expect(loaded).toEqual([]);
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'refuses a package name typed into the picker that is not valid, before anything changes',
    async () => {
      const run = await harness(await unlistedPackage()).run(['orm', 'init', '--json'], {
        cwd: projectDir,
        isTty: { stdin: true },
        answers: ['another-package', '../outside'],
      });

      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_INVALID_FLAG_VALUE',
          summary: 'Invalid target package name',
          meta: { value: '../outside' },
        },
      });
      expect(installs).toEqual([]);
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'reports a failed first install with the package as target and package, and writes nothing',
    async () => {
      installsFail = true;
      const run = await harness(await unlistedPackage()).run(starter(UNLISTED), {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(4);
      expect(envelopeOf(run)).toMatchObject({
        ok: true,
        exitCode: 4,
        diagnostics: [{ code: 'CLI.INIT_INSTALL_FAILED', meta: { filesWritten: [] } }],
      });
      expect(run.presented?.data).toMatchObject({
        target: UNLISTED,
        package: UNLISTED,
        filesWritten: [],
        packagesInstalled: { status: 'failed', deps: [], devDeps: [] },
      });
      expect(installs).toEqual([['add', UNLISTED, 'dotenv']]);
      expect(loaded).toEqual([]);
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    're-initialising with another target does not offer to remove the unlisted package',
    async () => {
      writeProjectFile(
        'package.json',
        `${JSON.stringify({ name: 'app', dependencies: { [UNLISTED]: '^1.0.0' } }, null, 2)}\n`,
      );
      writeProjectFile('prisma.config.ts', 'export default {}\n');

      const run = await harness().run(
        [...starter('postgres'), '--skip-install', '--confirm', basename(projectDir)],
        { cwd: projectDir },
      );

      expect(run.exitCode, JSON.stringify(envelopeOf(run))).toBe(0);
      expect(JSON.parse(readProjectFile('package.json'))).toMatchObject({
        dependencies: { [UNLISTED]: '^1.0.0' },
      });
    },
    timeouts.coldTransformImport,
  );
});

describe('an unlisted package that cannot be used', () => {
  it(
    'installs the package of that name, then says it was taken as a package name',
    async () => {
      const run = await harness(packageWithoutInit(NO_INIT)).run(starter(NO_INIT), {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(2);
      expect(installs).toEqual([['add', NO_INIT, 'dotenv']]);
      expect(loaded).toEqual(['prisma-orm-noinit/init']);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_CONTRIBUTION_UNAVAILABLE',
          why: '`prisma-orm-noinit` is not one of the short names (postgres, mongodb), so init took it as a package name. prisma-orm-noinit has no `prisma-orm-noinit/init` entrypoint, so it does not support `prisma orm init`. prisma-orm-noinit is installed; no scaffold file was written.',
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label:
                'Write prisma.config.ts by hand, with the defineConfig import the README of prisma-orm-noinit shows. To use a target package from the list instead, pass its short name (--target postgres, --target mongodb); for any other, pass its full package name.',
            }),
          ]),
          meta: {
            packageName: NO_INIT,
            reason: 'no-entrypoint',
            takenAsPackageName: true,
            packagesAdded: [NO_INIT, 'dotenv'],
          },
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'says it was taken as a package name when --skip-install finds no such package, without a lookup',
    async () => {
      const run = await harness().run([...starter(NO_INIT), '--skip-install'], {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(2);
      expect(installs).toEqual([]);
      expect(lookups).toEqual([]);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_TARGET_PACKAGE_NOT_INSTALLED',
          why: expect.stringMatching(
            /^`prisma-orm-noinit` is not one of the short names \(postgres, mongodb\), so init took it as a package name\. /,
          ),
          nextActions: [
            expect.objectContaining({
              label: `Run \`prisma orm init\` again without \`--skip-install\`: it checks that ${NO_INIT} lists the keyword \`prisma-orm-extension\` before installing it. To use a target package from the list instead, pass its short name (--target postgres, --target mongodb); for any other, pass its full package name.`,
            }),
          ],
          meta: { packageName: NO_INIT, takenAsPackageName: true },
        },
      });
      expect(JSON.stringify(run.json)).not.toContain(`add ${NO_INIT}`);
    },
    timeouts.coldTransformImport,
  );
});

const LISTED_INSTEAD =
  'To use a target package from the list instead, pass its short name (--target postgres, --target mongodb); for any other, pass its full package name.';

const TAKEN = (name: string) =>
  `\`${name}\` is not one of the short names (postgres, mongodb), so init took it as a package name.`;

function installPackage(name: string, keywords: readonly string[] | undefined): void {
  writeProjectFile(
    `node_modules/${name}/package.json`,
    JSON.stringify({ name, version: '1.0.0', ...(keywords === undefined ? {} : { keywords }) }),
  );
}

function declarePackage(name: string): void {
  writeProjectFile(
    'package.json',
    `${JSON.stringify({ name: 'app', dependencies: { [name]: '^1.0.0' } }, null, 2)}\n`,
  );
}

describe('an unlisted package that does not list the Prisma 8 keyword', () => {
  it.each(['sqlite', 'mysql', 'postgre'])(
    'refuses --target %s without installing anything',
    async (value) => {
      registryAnswer = { kind: 'read', registry: REGISTRY, keywords: ['database', value] };

      const run = await harness().run(starter(value), { cwd: projectDir });

      expect(run.exitCode).toBe(2);
      expect(lookups).toEqual([value]);
      expect(installs).toEqual([]);
      expect(loaded).toEqual([]);
      expect(projectEntries()).toEqual([]);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_TARGET_PACKAGE_NOT_VERIFIED',
          summary: `${value} does not list the keyword \`${KEYWORD}\``,
          why: `${TAKEN(value)} The latest version of ${value} on ${REGISTRY} does not list the keyword \`${KEYWORD}\` in its package.json. init requires that keyword of a target package before it installs or uses one, so it did not install ${value}. Nothing was changed.`,
          nextActions: [
            expect.objectContaining({
              label: `Check the package name. If you maintain ${value}, add \`${KEYWORD}\` to the keywords in its package.json and publish a new version. ${LISTED_INSTEAD}`,
            }),
          ],
          meta: {
            reason: 'keyword-missing',
            packageName: value,
            keyword: KEYWORD,
            registry: REGISTRY,
            takenAsPackageName: true,
          },
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'refuses a package name typed into the picker the same way',
    async () => {
      registryAnswer = { kind: 'read', registry: REGISTRY, keywords: [] };

      const run = await harness().run(['orm', 'init', '--json'], {
        cwd: projectDir,
        isTty: { stdin: true },
        answers: ['another-package', 'sqlite', 'psl', 'src/prisma/contract.prisma', false],
      });

      expect(lookups).toEqual(['sqlite']);
      expect(installs).toEqual([]);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_TARGET_PACKAGE_NOT_VERIFIED',
          meta: { reason: 'keyword-missing', packageName: 'sqlite' },
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'accepts an unscoped name with no prefix when the package lists the keyword',
    async () => {
      const run = await harness(await unlistedPackage('acmedb')).run(starter('acmedb'), {
        cwd: projectDir,
      });

      expect(run.exitCode, JSON.stringify(envelopeOf(run))).toBe(0);
      expect(lookups).toEqual(['acmedb']);
      expect(installs[0]).toEqual(['add', 'acmedb', 'dotenv']);
      expect(run.presented?.data).toMatchObject({ target: 'acmedb', package: 'acmedb' });
    },
    timeouts.coldTransformImport,
  );

  it(
    'refuses a package the registry does not have, without installing or writing anything',
    async () => {
      registryAnswer = { kind: 'not-found', registry: REGISTRY };

      const run = await harness().run(starter('acmedb'), { cwd: projectDir });

      expect(run.exitCode).toBe(2);
      expect(installs).toEqual([]);
      expect(projectEntries()).toEqual([]);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_TARGET_PACKAGE_NOT_VERIFIED',
          summary: 'acmedb was not found',
          why: `${TAKEN('acmedb')} No package named acmedb was found on ${REGISTRY}. Nothing was changed.`,
          nextActions: [
            expect.objectContaining({
              label: `Check the package name. init asks only ${REGISTRY} and sends no credentials, so a package on another registry, or one that needs credentials, is not found there: install it yourself with \`pnpm add acmedb\` and run \`prisma orm init\` again, and init reads it from disk. ${LISTED_INSTEAD}`,
            }),
          ],
          meta: {
            reason: 'not-found',
            packageName: 'acmedb',
            keyword: KEYWORD,
            registry: REGISTRY,
            takenAsPackageName: true,
          },
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'refuses when the registry cannot be read, without installing or writing anything',
    async () => {
      registryAnswer = {
        kind: 'lookup-failed',
        registry: REGISTRY,
        cause: 'the registry answered with status 403',
      };

      const run = await harness().run(starter('acmedb'), { cwd: projectDir });

      expect(run.exitCode).toBe(2);
      expect(installs).toEqual([]);
      expect(projectEntries()).toEqual([]);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_TARGET_PACKAGE_NOT_VERIFIED',
          summary: 'Could not read the keywords of acmedb',
          why: `${TAKEN('acmedb')} init requires the keyword \`${KEYWORD}\` of a target package before it installs or uses one, and it could not read the keywords of acmedb from ${REGISTRY}: the registry answered with status 403. Nothing was changed.`,
          nextActions: [
            expect.objectContaining({
              label: `Check the package name. If it is right and acmedb lists \`${KEYWORD}\`, install it yourself with \`pnpm add acmedb\` and run \`prisma orm init\` again: init reads the keywords of an installed package from disk. ${LISTED_INSTEAD}`,
            }),
          ],
          meta: {
            reason: 'lookup-failed',
            packageName: 'acmedb',
            keyword: KEYWORD,
            registry: REGISTRY,
            takenAsPackageName: true,
          },
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'settles a run cancelled during the lookup as cancelled, not as a refusal',
    async () => {
      const cancel = new AbortController();
      const lookUp: LookUpRegistryKeywords = (packageName, { signal }) => {
        lookups.push(packageName);
        setTimeout(() => cancel.abort(), 0);
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      };

      const run = await harness(importFromProject, lookUp).run(starter('acmedb'), {
        cwd: projectDir,
        abort: cancel.signal,
      });

      expect(lookups).toEqual(['acmedb']);
      expect(installs).toEqual([]);
      expect(envelopeOf(run)).toMatchObject({ ok: false, error: { code: 'CLI.ABORTED' } });
    },
    timeouts.coldTransformImport,
  );

  it(
    'never shows the credentials of the registry URL',
    async () => {
      vi.stubGlobal('fetch', async () => new Response('{}', { status: 403 }));

      const run = await harness(importFromProject, realRegistryLookup).run(starter('acmedb'), {
        cwd: projectDir,
        env: { npm_config_registry: 'https://user:token@registry.example/' },
      });

      const output = JSON.stringify(run.json);
      expect(envelopeOf(run)).toMatchObject({
        error: { code: 'CLI.INIT_TARGET_PACKAGE_NOT_VERIFIED', meta: { reason: 'lookup-failed' } },
      });
      expect(output).not.toContain('token');
      expect(output).not.toContain('user:');
    },
    timeouts.coldTransformImport,
  );

  it(
    'names the registry init asked as it asked it, without credentials',
    async () => {
      vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }));

      const run = await harness(importFromProject, realRegistryLookup).run(starter('acmedb'), {
        cwd: projectDir,
        env: { npm_config_registry: 'https://user:token@registry.example/' },
      });

      expect(envelopeOf(run)).toMatchObject({
        error: {
          why: `${TAKEN('acmedb')} No package named acmedb was found on https://registry.example. Nothing was changed.`,
          nextActions: [
            expect.objectContaining({
              label: expect.stringContaining(
                'init asks only https://registry.example and sends no credentials',
              ),
            }),
          ],
          meta: { reason: 'not-found', registry: 'https://registry.example' },
        },
      });
      expect(JSON.stringify(run.json)).not.toMatch(/token|\*\*\*\*/);
    },
    timeouts.coldTransformImport,
  );

  it(
    'never looks up a listed package',
    async () => {
      const run = await harness().run([...starter('postgres'), '--skip-install'], {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(0);
      expect(lookups).toEqual([]);
    },
    timeouts.coldTransformImport,
  );
});

describe('which copy of an unlisted package init checks', () => {
  it(
    'reads a package that is declared and on disk from disk, since init will not install it',
    async () => {
      declarePackage('acmedb');
      installPackage('acmedb', [KEYWORD]);
      registryAnswer = { kind: 'not-found', registry: REGISTRY };

      const run = await harness(await unlistedPackage('acmedb')).run(starter('acmedb'), {
        cwd: projectDir,
      });

      expect(run.exitCode, JSON.stringify(envelopeOf(run))).toBe(0);
      expect(lookups).toEqual([]);
      expect(installs[0]).toEqual(['add', 'dotenv']);
      expect(loaded).toEqual(['acmedb/init']);
    },
    timeouts.coldTransformImport,
  );

  it(
    'reads a package on disk from disk under --skip-install',
    async () => {
      installPackage('acmedb', [KEYWORD]);
      registryAnswer = { kind: 'not-found', registry: REGISTRY };

      const run = await harness(await unlistedPackage('acmedb')).run(
        [...starter('acmedb'), '--skip-install'],
        { cwd: projectDir },
      );

      expect(run.exitCode, JSON.stringify(envelopeOf(run))).toBe(0);
      expect(lookups).toEqual([]);
      expect(installs).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'installs a package on disk but not declared once the registry copy lists the keyword',
    async () => {
      installPackage('acmedb', ['database']);

      const run = await harness(await unlistedPackage('acmedb')).run(starter('acmedb'), {
        cwd: projectDir,
      });

      expect(run.exitCode, JSON.stringify(envelopeOf(run))).toBe(0);
      expect(lookups).toEqual(['acmedb']);
      expect(installs[0]).toEqual(['add', 'acmedb', 'dotenv']);
    },
    timeouts.coldTransformImport,
  );

  it(
    'asks the registry for a package on disk but not declared, since init installs that one',
    async () => {
      installPackage('acmedb', [KEYWORD]);
      registryAnswer = { kind: 'read', registry: REGISTRY, keywords: ['database'] };

      const run = await harness(await unlistedPackage('acmedb')).run(starter('acmedb'), {
        cwd: projectDir,
      });

      expect(lookups).toEqual(['acmedb']);
      expect(installs).toEqual([]);
      expect(envelopeOf(run)).toMatchObject({
        error: {
          code: 'CLI.INIT_TARGET_PACKAGE_NOT_VERIFIED',
          meta: { reason: 'keyword-missing', registry: REGISTRY },
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it.each([
    ['declared and on disk', [], true],
    ['on disk under --skip-install', ['--skip-install'], false],
  ])(
    'refuses a package %s that does not list the keyword, reading it from disk',
    async (_, extra, declared) => {
      if (declared) declarePackage('acmedb');
      installPackage('acmedb', ['database']);

      const run = await harness(await unlistedPackage('acmedb')).run(
        [...starter('acmedb'), ...extra],
        { cwd: projectDir },
      );

      expect(run.exitCode).toBe(2);
      expect(lookups).toEqual([]);
      expect(installs).toEqual([]);
      expect(loaded).toEqual([]);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_TARGET_PACKAGE_NOT_VERIFIED',
          why: `${TAKEN('acmedb')} The installed acmedb does not list the keyword \`${KEYWORD}\` in its package.json. init requires that keyword of a target package before it installs or uses one, so it did not use acmedb. Nothing was changed.`,
          nextActions: [
            expect.objectContaining({
              label: `Check the package name. If a newer version of acmedb lists the keyword, update it with \`pnpm add acmedb@latest\` and run \`prisma orm init\` again. If you maintain acmedb, add \`${KEYWORD}\` to the keywords in its package.json and publish a new version. ${LISTED_INSTEAD}`,
            }),
          ],
          meta: { reason: 'keyword-missing', packageName: 'acmedb', keyword: KEYWORD },
        },
      });
      expect(Reflect.get(envelopeOf(run).error.meta, 'registry')).toBeUndefined();
    },
    timeouts.coldTransformImport,
  );

  it(
    'refuses an installed package whose keywords are not a list',
    async () => {
      writeProjectFile(
        'node_modules/acmedb/package.json',
        JSON.stringify({ name: 'acmedb', keywords: KEYWORD }),
      );

      const run = await harness().run([...starter('acmedb'), '--skip-install'], {
        cwd: projectDir,
      });

      expect(envelopeOf(run)).toMatchObject({
        error: {
          code: 'CLI.INIT_TARGET_PACKAGE_NOT_VERIFIED',
          meta: { reason: 'keyword-missing' },
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'reports an installed package.json that cannot be parsed as a failed read, naming the file',
    async () => {
      writeProjectFile('node_modules/acmedb/package.json', '{ "name": ');

      const run = await harness().run([...starter('acmedb'), '--skip-install'], {
        cwd: projectDir,
      });

      expect(lookups).toEqual([]);
      expect(envelopeOf(run)).toMatchObject({
        error: {
          code: 'CLI.INIT_TARGET_PACKAGE_NOT_VERIFIED',
          why: expect.stringContaining(
            'could not read the keywords of acmedb: node_modules/acmedb/package.json cannot be read as JSON: ',
          ),
          nextActions: [
            expect.objectContaining({
              label: `Check the package name. If it is right, reinstall acmedb with \`pnpm add acmedb\` and run \`prisma orm init\` again. ${LISTED_INSTEAD}`,
            }),
          ],
          meta: { reason: 'lookup-failed', packageName: 'acmedb' },
        },
      });
      expect(Reflect.get(envelopeOf(run).error.meta, 'registry')).toBeUndefined();
    },
    timeouts.coldTransformImport,
  );
});

describe('an unlisted --target in a Prisma 7 project', () => {
  const PRISMA7_SCHEMA = 'prisma/schema.prisma';

  it.each([
    ['a string provider', 'datasource db {\n  provider = "sqlite"\n}\n'],
    ['a provider that is not a string literal', 'datasource db {\n  provider = env("DB")\n}\n'],
  ])(
    'refuses --from-prisma7-schema with %s before installing, since only a listed package keeps the schema',
    async (_, schema) => {
      writeProjectFile(PRISMA7_SCHEMA, schema);

      const run = await harness(await unlistedPackage()).run(
        ['orm', 'init', '--target', UNLISTED, '--from-prisma7-schema', PRISMA7_SCHEMA, '--json'],
        { cwd: projectDir },
      );

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE',
          why: `${UNLISTED} is not one of the target packages in Prisma's list (postgres, mongodb), and only a package in that list can keep ${PRISMA7_SCHEMA} as the contract source. Nothing was changed.`,
          nextActions: [
            expect.objectContaining({
              label: `Run \`prisma orm init\` without \`--from-prisma7-schema\` to start a fresh contract on ${UNLISTED}. To keep ${PRISMA7_SCHEMA}, name a target package from the list instead.`,
            }),
          ],
          meta: { schemaPath: PRISMA7_SCHEMA, packageName: UNLISTED, reason: 'unlisted' },
        },
      });
      expect(installs).toEqual([]);
      expect(loaded).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'without the flag, does not offer the schema and warns that init sets up a fresh project',
    async () => {
      writeProjectFile(PRISMA7_SCHEMA, 'datasource db {\n  provider = "postgresql"\n}\n');

      const run = await harness(await unlistedPackage()).run(
        ['orm', 'init', '--target', UNLISTED, '--json'],
        {
          cwd: projectDir,
          isTty: { stdin: true },
          answers: ['psl', 'src/prisma/contract.prisma', false],
        },
      );

      expect(run.exitCode, JSON.stringify(envelopeOf(run))).toBe(0);
      expect(run.presented?.data).toMatchObject({
        authoring: 'psl',
        prisma7: null,
        warnings: expect.arrayContaining([
          `${UNLISTED} is not in the list of target packages that can keep a Prisma 7 schema, so init sets up a fresh Prisma 8 project instead and leaves ${PRISMA7_SCHEMA} alone.`,
        ]),
      });
      expect(readProjectFile(PRISMA7_SCHEMA)).toContain('provider = "postgresql"');
    },
    timeouts.coldTransformImport,
  );
});

describe('init with a listed target package', () => {
  it(
    'reports a failed first install with the short name as target and the package name as package',
    async () => {
      installsFail = true;
      const run = await harness().run(starter('postgres'), { cwd: projectDir });

      expect(run.exitCode).toBe(4);
      expect(run.presented?.data).toMatchObject({
        target: 'postgres',
        package: '@prisma/orm-postgres',
        packagesInstalled: { status: 'failed', deps: [], devDeps: [] },
      });
      expect(installs).toEqual([['add', '@prisma/orm-postgres', 'dotenv', 'pg']]);
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'reports the short name as target and the package name as package',
    async () => {
      const run = await harness().run([...starter('postgres'), '--skip-install'], {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({
        target: 'postgres',
        package: '@prisma/orm-postgres',
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'takes the package name of a listed package as that package, drivers in the first install',
    async () => {
      const run = await harness().run(starter('@prisma/orm-postgres'), { cwd: projectDir });

      expect(run.exitCode).toBe(0);
      expect(installs[0]).toEqual(['add', '@prisma/orm-postgres', 'dotenv', 'pg']);
      expect(run.presented?.data).toMatchObject({
        target: 'postgres',
        package: '@prisma/orm-postgres',
      });
    },
    timeouts.coldTransformImport,
  );
});

describe('init with the published target packages that are in no list', () => {
  it.each([
    ['@prisma/orm-sqlite', '@internal/sqlite'],
    ['@prisma/orm-mysql', '@internal/mysql'],
  ])(
    'writes the project from the contribution of %s',
    async (packageName, moduleBase) => {
      const run = await harness().run([...starter(packageName), '--skip-install'], {
        cwd: projectDir,
      });

      expect(run.exitCode, JSON.stringify(envelopeOf(run))).toBe(0);
      expect(run.presented?.data).toMatchObject({ target: packageName, package: packageName });
      expect(readFileSync(join(projectDir, 'prisma.config.ts'), 'utf-8')).toContain(
        `from '${moduleBase}/config'`,
      );
      expect(readFileSync(join(projectDir, 'src/prisma/db.ts'), 'utf-8')).toContain(
        `from '${moduleBase}/runtime'`,
      );
      expect(existsSync(join(projectDir, 'prisma-8.md'))).toBe(true);
    },
    timeouts.coldTransformImport,
  );

  it.each([
    ['@prisma/orm-sqlite', 'psl', 'src/prisma/contract.prisma'],
    ['@prisma/orm-sqlite', 'typescript', 'src/prisma/contract.ts'],
    ['@prisma/orm-mysql', 'psl', 'src/prisma/contract.prisma'],
    ['@prisma/orm-mysql', 'typescript', 'src/prisma/contract.ts'],
  ] as const)(
    'writes exactly the files the contribution of %s gives for %s',
    async (packageName, authoring, schemaPath) => {
      const contribution = await fixtureContribution(packageName);

      const run = await harness().run(
        ['orm', 'init', '--target', packageName, '--authoring', authoring, '--write-env'].concat(
          '--skip-install',
          '--json',
        ),
        { cwd: projectDir },
      );

      expect(run.exitCode, JSON.stringify(envelopeOf(run))).toBe(0);
      expect(readProjectFile(schemaPath)).toBe(contribution.starterContract(authoring));
      expect(readProjectFile('prisma.config.ts')).toBe(
        configFile(`./${schemaPath}`, contribution.configModule),
      );
      expect(readProjectFile('src/prisma/db.ts')).toBe(contribution.databaseFile());
      expect(readProjectFile('.env')).toBe(contribution.envExample());
    },
    timeouts.coldTransformImport,
  );
});
