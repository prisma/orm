import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { MountedTree, PackageManagerId, PackageManagerRunner } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createInitCommand, type InitCommandDependencies } from '../../src/orm/init';

export const PNPM_WORKSPACE_LEAK =
  'ERR_PNPM_WORKSPACE_PKG_NOT_FOUND  In : "@prisma/orm-postgres@workspace:*" is in the dependencies but no package named "@prisma/orm-postgres" is present in the workspace';

/** What pnpm 12 writes to stderr when strictDepBuilds (on by default) stops an add. */
export const PNPM_12_IGNORED_BUILDS = [
  'Error: ERR_PNPM_IGNORED_BUILDS',
  '',
  '  × adding a new package',
  '  ╰─▶ Ignored build scripts: esbuild@0.28.2, msgpackr-extract@3.0.4,',
  '      workerd@1.20260704.1',
  '  help: Run "pnpm approve-builds" to pick which dependencies should be allowed',
  '        to run scripts.',
].join('\n');

/** What pnpm 11 writes to stdout, not stderr, in the same case. */
export const PNPM_11_IGNORED_BUILDS = [
  '[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.2',
  'Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.',
].join('\n');

export const IGNORED_BUILDS_WARNING = [
  'pnpm did not run the build scripts of some dependencies, because they are not approved (ERR_PNPM_IGNORED_BUILDS).',
  'pnpm reports that as a failure, but it had already installed the packages, so init continued.',
  'Run `pnpm approve-builds` to choose which dependencies may run their build scripts.',
].join('\n');

export const MINIMAL_MANIFEST_WARNING =
  'No package.json found in the target directory; created a minimal one. Edit `name` / `version` to taste.';

export interface RunnerCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface ScriptedResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout?: string;
  /** Leaves on disk what pnpm 11 has written by the time it fails an add over ignored build scripts. */
  readonly writesPnpm11Records?: boolean;
}

/** A package-manager runner that records each call and answers from `script`, then succeeds. */
export interface ScriptedInstalls {
  readonly calls: RunnerCall[];
  script: ScriptedResult[];
  readonly runner: PackageManagerRunner;
}

export function scriptedInstalls(): ScriptedInstalls {
  const installs: ScriptedInstalls = {
    calls: [],
    script: [],
    runner: async (request) => {
      installs.calls.push({ file: request.file, args: [...request.args], cwd: request.cwd });
      const result = installs.script.shift() ?? { exitCode: 0, stderr: '' };
      if (result.stdout !== undefined) {
        request.onOutput('data', result.stdout);
      }
      if (result.writesPnpm11Records === true) {
        writePnpm11Records(request.cwd, request.args);
      }
      return { exitCode: result.exitCode, stderr: result.stderr };
    },
  };
  return installs;
}

function writePnpm11Records(cwd: string, args: readonly string[]): void {
  const manifestPath = join(cwd, 'package.json');
  const manifest: Record<string, unknown> = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf-8'))
    : {};
  const field = args.includes('-D') ? 'devDependencies' : 'dependencies';
  const added = args.filter((arg) => arg !== 'add' && arg !== '-D');
  writeFileSync(
    manifestPath,
    JSON.stringify({ ...manifest, [field]: Object.fromEntries(added.map((spec) => [spec, '*'])) }),
  );
  mkdirSync(join(cwd, 'node_modules'), { recursive: true });
  writeFileSync(
    join(cwd, 'node_modules', '.modules.yaml'),
    JSON.stringify({ ignoredBuilds: ['esbuild@0.28.2'], pendingBuilds: [] }),
  );
}

/** The production command tree, with `init` rebuilt around the given dependencies. */
export function initTestCli(ctx: {
  readonly dependencies: InitCommandDependencies;
  readonly runner: PackageManagerRunner | undefined;
  readonly packageManager: PackageManagerId | undefined;
}) {
  const commands: MountedTree = {
    ...BIN_COMMANDS,
    'orm init': createInitCommand(ctx.dependencies),
  };
  return createTestCli({
    commands,
    groups: BIN_GROUPS,
    ...(ctx.runner === undefined ? {} : { packageManagerRunner: ctx.runner }),
    ...(ctx.packageManager === undefined ? {} : { packageManager: ctx.packageManager }),
  });
}

type InitRun = Awaited<ReturnType<ReturnType<typeof initTestCli>['run']>>;

export function envelopeOf(run: { readonly json: readonly { readonly kind: string }[] }) {
  const terminal = run.json.at(-1);
  return terminal !== undefined && terminal.kind === 'result'
    ? Reflect.get(terminal, 'envelope')
    : undefined;
}

/** The test project sits inside this repository, so init also sees the repository's own pnpm catalog. */
function isRepositoryCatalogWarning(text: string): boolean {
  return text.startsWith('pnpm workspace catalog overrides detected');
}

export function installSummary(run: InitRun, calls: readonly RunnerCall[]) {
  const data = Object(run.presented?.data);
  const warnings: readonly string[] = Reflect.get(data, 'warnings');
  return {
    exitCode: run.exitCode,
    calls: calls.map((call) => `${call.file} ${call.args.join(' ')}`),
    packagesInstalled: Reflect.get(data, 'packagesInstalled'),
    contractEmitted: Reflect.get(data, 'contractEmitted'),
    warnings: warnings.filter((text) => !isRepositoryCatalogWarning(text)),
  };
}
