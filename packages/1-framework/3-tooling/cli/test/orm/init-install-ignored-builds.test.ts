import { existsSync, rmSync } from 'node:fs';
import type { PackageManagerId } from '@prisma/cli-engine';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importFromProject } from '../../src/orm/init-prisma7-check';
import { createTestProjectDir } from '../utils/test-project-dir';
import {
  envelopeOf,
  IGNORED_BUILDS_WARNING,
  initTestCli,
  installSummary,
  MINIMAL_MANIFEST_WARNING,
  PNPM_11_IGNORED_BUILDS,
  PNPM_12_IGNORED_BUILDS,
  type ScriptedInstalls,
  scriptedInstalls,
} from './init-install-fixtures';
import { copyPrisma7Fixture, prisma7InitArgv } from './init-prisma7-fixtures';

const emit = vi.fn();

let projectDir: string;
let installs: ScriptedInstalls;

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-ignored-builds');
  installs = scriptedInstalls();
  emit.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function harness(packageManager?: PackageManagerId) {
  return initTestCli({
    dependencies: { emitScaffoldedContract: emit, importFromProject },
    runner: installs.runner,
    packageManager,
  });
}

function scaffoldArgv(...extra: string[]): string[] {
  return ['orm', 'init', '--target', 'postgres', '--authoring', 'psl', ...extra];
}

describe('build scripts pnpm has not been told to trust', () => {
  it(
    'completes with one warning when pnpm 12 fails both adds only over ignored build scripts',
    async () => {
      installs.script = [
        { exitCode: 1, stderr: PNPM_12_IGNORED_BUILDS },
        { exitCode: 1, stderr: PNPM_12_IGNORED_BUILDS },
      ];

      const run = await harness('pnpm').run(scaffoldArgv(), { cwd: projectDir });

      expect(installSummary(run, installs.calls)).toEqual({
        exitCode: 0,
        calls: [
          'pnpm add @prisma/orm-postgres dotenv',
          'pnpm add -D prisma@latest @types/node @prisma/cli-engine@latest',
        ],
        packagesInstalled: {
          status: 'installed',
          deps: ['@prisma/orm-postgres', 'dotenv'],
          devDeps: ['prisma@latest', '@types/node', '@prisma/cli-engine@latest'],
        },
        contractEmitted: true,
        warnings: [MINIMAL_MANIFEST_WARNING, IGNORED_BUILDS_WARNING],
      });
      expect(emit).toHaveBeenCalledWith({ cwd: projectDir });
    },
    timeouts.coldTransformImport,
  );

  it(
    'still fails pnpm 11, which names the code only on stdout, which the package-manager capability does not return',
    async () => {
      installs.script = [
        { exitCode: 1, stderr: '', stdout: PNPM_11_IGNORED_BUILDS, writesPnpm11Records: true },
      ];

      const run = await harness('pnpm').run([...scaffoldArgv(), '--json'], { cwd: projectDir });

      expect(installSummary(run, installs.calls)).toEqual({
        exitCode: 4,
        calls: ['pnpm add @prisma/orm-postgres dotenv'],
        packagesInstalled: { status: 'failed', deps: [], devDeps: [] },
        contractEmitted: false,
        warnings: [MINIMAL_MANIFEST_WARNING],
      });
      expect(envelopeOf(run)).toMatchObject({
        diagnostics: [{ code: 'CLI.INIT_INSTALL_FAILED', severity: 'error' }],
      });
      expect(emit).not.toHaveBeenCalled();
    },
    timeouts.coldTransformImport,
  );

  it.each([
    [
      'pnpm fails with another error code',
      'pnpm' as const,
      'ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/nope: Not Found - 404',
    ],
    ['pnpm fails with no error code', 'pnpm' as const, 'EACCES: permission denied'],
    ['another manager prints the pnpm code', 'npm' as const, PNPM_12_IGNORED_BUILDS],
  ])(
    'still fails the install when %s',
    async (_case, manager, stderr) => {
      installs.script = [{ exitCode: 1, stderr }];

      const run = await harness(manager).run([...scaffoldArgv(), '--json'], { cwd: projectDir });

      expect(installSummary(run, installs.calls)).toEqual({
        exitCode: 4,
        calls: [`${manager} add @prisma/orm-postgres dotenv`],
        packagesInstalled: { status: 'failed', deps: [], devDeps: [] },
        contractEmitted: false,
        warnings: [MINIMAL_MANIFEST_WARNING],
      });
      expect(envelopeOf(run)).toMatchObject({
        diagnostics: [{ code: 'CLI.INIT_INSTALL_FAILED', severity: 'error' }],
      });
      expect(emit).not.toHaveBeenCalled();
    },
    timeouts.coldTransformImport,
  );

  it(
    'proceeds with one warning when pnpm fails the install before the Prisma 7 check only over ignored build scripts',
    async () => {
      copyPrisma7Fixture(projectDir);
      installs.script = [
        { exitCode: 1, stderr: PNPM_12_IGNORED_BUILDS },
        { exitCode: 1, stderr: PNPM_12_IGNORED_BUILDS },
      ];

      const run = await harness('pnpm').run(prisma7InitArgv(projectDir), { cwd: projectDir });

      const data = Object(run.presented?.data);
      expect({
        exitCode: run.exitCode,
        installs: installs.calls.map((call) => call.args),
        packagesInstalled: Reflect.get(data, 'packagesInstalled'),
        ignoredBuildsWarnings: Reflect.get(data, 'warnings').filter((text: string) =>
          text.includes('ERR_PNPM_IGNORED_BUILDS'),
        ),
      }).toEqual({
        exitCode: 0,
        installs: [
          ['add', '@prisma/orm-postgres', 'dotenv'],
          [
            'add',
            '-D',
            'prisma@latest',
            '@types/node',
            '@prisma/prisma7@7',
            '@prisma/cli-engine@latest',
          ],
        ],
        packagesInstalled: {
          status: 'installed',
          deps: ['@prisma/orm-postgres', 'dotenv'],
          devDeps: [
            'prisma@latest',
            '@types/node',
            '@prisma/prisma7@7',
            '@prisma/cli-engine@latest',
          ],
        },
        ignoredBuildsWarnings: [IGNORED_BUILDS_WARNING],
      });
      expect(existsSync(join(projectDir, 'prisma7.config.ts'))).toBe(true);
    },
    timeouts.coldTransformImport,
  );
});
