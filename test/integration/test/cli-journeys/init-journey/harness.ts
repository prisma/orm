/**
 * Harness for the `prisma orm init` user-journey test (TML-2490).
 *
 * A "seam verifier" — exercises the full user inner loop from `prisma orm
 * init` through to a working query against a real DB, asserting the contract
 * at each seam between subsystems.
 *
 * This harness is deliberately separate from `journey-test-helpers.ts`. The
 * existing helpers invoke CLI commands in-process (faster, suitable for
 * lifecycle-focused journeys); this harness spawns the workspace-built CLI
 * as a real subprocess inside a fresh tmpdir so the seams it traverses are
 * the seams a real user traverses. The deliberate fidelity tax is what keeps
 * TML-2485-class bugs in the failure surface.
 */

import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { join, resolve } from 'pathe';

const execFileAsync = promisify(execFile);

/**
 * Path to the workspace-built CLI binary. The integration package's
 * `pretest` hook runs `pnpm -w build`, so `dist/bin.mjs` exists when these
 * tests run.
 */
const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../../../..');
const CLI_BIN = join(WORKSPACE_ROOT, 'packages/1-framework/3-tooling/cli/dist/bin.mjs');

/**
 * Shared cache root for the journey runs. Lives outside the repo (under
 * `~/.cache/pn-journey/`) for two reasons:
 *
 *  1. Path length. pnpm's content-addressable store encodes the **absolute**
 *     tarball path into the cached index filenames (using `+` as separator).
 *     A cache dir deep inside a long worktree path (e.g.
 *     `…/prisma-8-ws/worktrees/tml-2486-…/`) overflows the OS filename
 *     limit (`ENAMETOOLONG`). A short, stable prefix keeps things under
 *     the 255-char limit.
 *  2. Cross-run reuse. Repeated test runs hit the cache instead of repacking
 *     every workspace package.
 *
 * The tarball cache and the dedicated pnpm store sit side-by-side under
 * the same parent so their relative path encoding stays short.
 */
const JOURNEY_CACHE_ROOT = join(homedir(), '.cache', 'pn-journey');
const TARBALL_CACHE_DIR = join(JOURNEY_CACHE_ROOT, 'tarballs');
const PNPM_STORE_DIR = join(JOURNEY_CACHE_ROOT, 'pnpm-store');

export type Target = 'postgres' | 'mongo';
export type Authoring = 'psl' | 'typescript';

export interface CellId {
  readonly target: Target;
  readonly authoring: Authoring;
}

/**
 * Every (target × authoring) cell. Mirrors the existing
 * `cli.init-facade-imports.e2e.test.ts` cell set.
 */
export const ALL_CELLS: readonly CellId[] = [
  { target: 'postgres', authoring: 'typescript' },
  { target: 'postgres', authoring: 'psl' },
  { target: 'mongo', authoring: 'typescript' },
  { target: 'mongo', authoring: 'psl' },
];

export function cellLabel(cell: CellId): string {
  return `${cell.target} × ${cell.authoring}`;
}

export interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface JourneyProject {
  /** Absolute path to the tmpdir hosting the materialised project. */
  readonly dir: string;
  /** Which cell this project represents. */
  readonly cell: CellId;
  /** Result of the `prisma orm init` invocation that materialised the project. */
  readonly initResult: CommandRun;
  /** Result of the `pnpm install` invocation, or `null` when install was skipped. */
  readonly installResult: CommandRun | null;
  /** Tear down the tmpdir (idempotent). */
  cleanup(): void;
}

/** Result of a single journey step that runs a process inside the tmpdir. */
export interface StepResult extends CommandRun {
  /** The command + args that produced this result, for diagnostics. */
  readonly command: string;
}

interface CreateJourneyProjectOptions {
  /**
   * Whether to run `pnpm install` after the scaffold lands. The install
   * resolves every `@internal/*` dep against the workspace tarballs at
   * {@link TARBALL_CACHE_DIR} and uses `node-linker=isolated` so transitive
   * workspace packages are not hoisted into the tmpdir's top-level
   * `node_modules` — the exact pnpm layout that TML-2485 broke under.
   * Defaults to `true`.
   */
  readonly install?: boolean;
}

/**
 * Materialises a fresh project tmpdir, writes a minimal `package.json` (init
 * requires one to attach to), runs `prisma orm init --target <t> --authoring
 * <a> --yes --skip-install` via the workspace-built CLI binary as a real
 * subprocess, then optionally runs `pnpm install` against the workspace's
 * pre-packed tarballs with `node-linker=isolated`.
 *
 * The install step is what keeps TML-2485-class bugs (pnpm's isolated linker
 * hiding transitive workspace packages from the user's top-level
 * `node_modules`) in the failure surface. A shortcut using the workspace's
 * hoisted `node_modules` would silently mask them.
 */
export async function createJourneyProject(
  cell: CellId,
  options: CreateJourneyProjectOptions = {},
): Promise<JourneyProject> {
  const { install = true } = options;

  const dir = mkdtempSync(join(tmpdir(), `pn-journey-${cell.target}-${cell.authoring}-`));
  // Once the tmpdir exists, any thrown setup step (package.json
  // rewrite, tarball prep, install) would otherwise leak `dir` because
  // no caller ever receives the `cleanup()` handle. Wrap the rest of
  // setup in try/catch and remove `dir` before rethrowing.
  try {
    writeMinimalPackageJson(dir);

    const target = cell.target === 'mongo' ? 'mongodb' : 'postgres';
    const initResult = await runNode(
      [
        CLI_BIN,
        'orm',
        'init',
        '--target',
        target,
        '--authoring',
        cell.authoring,
        '--yes',
        '--skip-install',
      ],
      dir,
    );

    let installResult: CommandRun | null = null;
    if (install && initResult.exitCode === 0) {
      const tarballs = await prepareWorkspaceTarballs();
      rewritePackageJsonForTarballs(dir, cell, tarballs);
      writeIsolatedNpmrc(dir);
      installResult = await runPnpm(['install', '--no-frozen-lockfile'], dir);
    }

    return {
      dir,
      cell,
      initResult,
      installResult,
      cleanup() {
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Minimal `package.json` that satisfies init's precondition: a project root must already exist before init can attach to it. */
function writeMinimalPackageJson(dir: string): void {
  const pkg = {
    name: 'prisma-8-journey-fixture',
    version: '0.0.0',
    private: true,
    type: 'module',
  };
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
}

/**
 * Spawns `node <args>` inside `cwd` and captures the result. The CLI uses
 * `process.exit(code)`, so a non-zero exit surfaces as an `execFile`
 * rejection — we normalise both shapes into `CommandRun`.
 */
async function runNode(args: readonly string[], cwd: string): Promise<CommandRun> {
  return runExec('node', args, cwd);
}

async function runPnpm(args: readonly string[], cwd: string): Promise<CommandRun> {
  return runExec('pnpm', args, cwd, { maxBufferMb: 64 });
}

interface RunExecOptions {
  readonly maxBufferMb?: number;
}

async function runExec(
  bin: string,
  args: readonly string[],
  cwd: string,
  options: RunExecOptions = {},
): Promise<CommandRun> {
  const maxBuffer = (options.maxBufferMb ?? 16) * 1024 * 1024;
  try {
    const { stdout, stderr } = await execFileAsync(bin, args as string[], {
      cwd,
      maxBuffer,
      encoding: 'utf-8',
    });
    return { exitCode: 0, stdout: asString(stdout), stderr: asString(stderr) };
  } catch (error) {
    const e = error as { code?: number; stdout?: unknown; stderr?: unknown; message?: string };
    const exitCode = typeof e.code === 'number' ? e.code : 1;
    return {
      exitCode,
      stdout: asString(e.stdout),
      stderr: asString(e.stderr) || (e.message ?? ''),
    };
  }
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  // execFile with the default encoding returns Buffers; convert.
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return Buffer.from(value).toString('utf-8');
  }
  return String(value);
}

// --- Workspace tarball preparation -----------------------------------------
//
// Section drives the Phase A.2 strategy: rather than installing
// `@internal/*` packages from npm (where workspace versions are unpublished)
// or symlinking workspace source dirs (which would leak the workspace's
// hoisted `node_modules`), we pack each workspace package into a tarball once
// per test session and have the tmpdir install against those tarballs.
//
// This preserves the exact pnpm layout a real user gets (isolated linker,
// only declared deps visible at top level) — the layout where TML-2485 and
// its siblings live.

interface WorkspacePackage {
  readonly name: string;
  readonly version: string;
  readonly dir: string;
}

interface PackedTarballs {
  readonly byName: ReadonlyMap<string, string>;
}

let workspaceTarballPromise: Promise<PackedTarballs> | null = null;

async function prepareWorkspaceTarballs(): Promise<PackedTarballs> {
  if (workspaceTarballPromise === null) {
    workspaceTarballPromise = packAllWorkspacePackages();
  }
  return workspaceTarballPromise;
}

async function packAllWorkspacePackages(): Promise<PackedTarballs> {
  mkdirSync(TARBALL_CACHE_DIR, { recursive: true });
  mkdirSync(PNPM_STORE_DIR, { recursive: true });
  const packages = discoverWorkspacePackages();

  const byName = new Map<string, string>();
  const concurrency = 6;
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= packages.length) return;
          const pkg = packages[idx];
          if (pkg === undefined) return;
          const tarball = await packIfStale(pkg);
          byName.set(pkg.name, tarball);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return { byName };
}

function discoverWorkspacePackages(): WorkspacePackage[] {
  const packagesRoot = join(WORKSPACE_ROOT, 'packages');
  const found: WorkspacePackage[] = [];
  walkForPackageJsons(packagesRoot, found, 0);
  return found;
}

function walkForPackageJsons(dir: string, found: WorkspacePackage[], depth: number): void {
  if (depth > 6) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  if (entries.includes('package.json')) {
    const pkgJsonPath = join(dir, 'package.json');
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as {
        name?: string;
        version?: string;
        private?: boolean;
      };
      // Both scopes: the scaffold installs the published `@prisma/orm-*`
      // packages, and those are built from the `@internal/*` workspace
      // packages, which the overrides below have to reach so resolution never
      // leaves the tarball cache.
      const ours =
        typeof pkg.name === 'string' &&
        (pkg.name.startsWith('@internal/') || pkg.name.startsWith('@prisma/orm-'));
      if (ours && typeof pkg.name === 'string') {
        found.push({ name: pkg.name, version: pkg.version ?? '0.0.0', dir });
      }
    } catch {
      // Ignore malformed package.json files; we only care about ours.
    }
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('dist-') || entry === 'dist') continue;
    const child = join(dir, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(child);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkForPackageJsons(child, found, depth + 1);
    }
  }
}

async function packIfStale(pkg: WorkspacePackage): Promise<string> {
  const stableName = pkg.name.replace(/^@/, '').replace(/\//g, '-');
  const tarballPath = join(TARBALL_CACHE_DIR, `${stableName}.tgz`);

  if (existsSync(tarballPath) && !isStale(pkg, tarballPath)) {
    return tarballPath;
  }

  // `pnpm pack` rewrites the source `package.json` in place to drop fields
  // that are redundant when `exports` is present (e.g. `main`, `module`).
  // That is fine for the published tarball but a non-starter inside a git
  // worktree — it would leave the workspace dirty after every test run.
  // Snapshot the raw bytes, restore them after pack.
  const pkgJsonPath = join(pkg.dir, 'package.json');
  const original = readFileSync(pkgJsonPath);
  let packResult: CommandRun;
  try {
    // `runExec` does not throw on non-zero exit; capture the result so
    // pack failures surface here with full stdout/stderr instead of
    // manifesting later as a confusing install error against a missing
    // tarball.
    packResult = await runExec('pnpm', ['pack', '--pack-destination', TARBALL_CACHE_DIR], pkg.dir);
  } finally {
    writeFileSync(pkgJsonPath, original);
  }
  if (packResult.exitCode !== 0) {
    throw new Error(
      [
        `pnpm pack failed for ${pkg.name} (exit ${packResult.exitCode})`,
        `  cwd: ${pkg.dir}`,
        '  stdout:',
        packResult.stdout,
        '  stderr:',
        packResult.stderr,
      ].join('\n'),
    );
  }

  // pnpm pack uses its own filename convention (`<scope>-<name>-<version>.tgz`);
  // rename to our stable name so the lookup-by-name above stays trivial.
  const expectedPnpmName = `${pkg.name.replace(/^@/, '').replace(/\//g, '-')}-${pkg.version}.tgz`;
  const expectedPath = join(TARBALL_CACHE_DIR, expectedPnpmName);
  if (existsSync(expectedPath) && expectedPath !== tarballPath) {
    rmSync(tarballPath, { force: true });
    writeFileSync(tarballPath, readFileSync(expectedPath));
    rmSync(expectedPath, { force: true });
  }
  if (!existsSync(tarballPath)) {
    throw new Error(
      `pnpm pack reported success for ${pkg.name} but no tarball exists at ${tarballPath} (expected pnpm output at ${expectedPath}).`,
    );
  }
  return tarballPath;
}

function isStale(pkg: WorkspacePackage, tarballPath: string): boolean {
  const tarballMtime = statSync(tarballPath).mtimeMs;
  return newestMtime(pkg.dir) > tarballMtime;
}

function newestMtime(dir: string): number {
  let newest = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('dist-') || entry === '.turbo') continue;
      const child = join(current, entry);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(child);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(child);
      } else if (stat.mtimeMs > newest) {
        newest = stat.mtimeMs;
      }
    }
  }
  return newest;
}

function rewritePackageJsonForTarballs(dir: string, cell: CellId, tarballs: PackedTarballs): void {
  const pkgJsonPath = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    pnpm?: { overrides?: Record<string, string> };
  };

  const facade = cell.target === 'mongo' ? '@prisma/orm-mongo' : '@prisma/orm-postgres';
  const facadeTarball = requireTarball(tarballs, facade);

  // The framework-emitted `migration.ts` imports the target package
  // directly rather than through the user-facing facade. Under
  // `node-linker=isolated` (the layout this journey deliberately uses to
  // catch TML-2485-class bugs) that is only reachable when declared as a
  // direct dep. The init scaffold itself does not currently declare it, so
  // a real user running `tsx migrations/.../migration.ts emit` under
  // isolated linking would hit `ERR_MODULE_NOT_FOUND` — a real scaffold
  // seam worth filing separately. Add it here so the journey can complete
  // end-to-end; the scaffold gap is a follow-up.
  const migrationDeps =
    cell.target === 'mongo' ? ['@prisma/orm-target-mongo'] : ['@prisma/orm-target-postgres'];
  const migrationDepEntries = Object.fromEntries(
    migrationDeps.map((name) => [name, `file:${requireTarball(tarballs, name)}`]),
  );

  pkg.dependencies = {
    ...(pkg.dependencies ?? {}),
    [facade]: `file:${facadeTarball}`,
    ...migrationDepEntries,
    dotenv: '^16.4.5',
  };
  // No standalone-CLI devDependency: journey steps invoke the
  // workspace-built engine bin.
  // `@prisma/cli-engine` is the scaffolded prisma.config.ts's
  // definePrismaConfig import, installed from the registry exactly as
  // `init`'s own install would. Must be an engine that has that export
  // (0.2.0+), and should track what the workspace pins.
  pkg.devDependencies = {
    ...(pkg.devDependencies ?? {}),
    '@prisma/cli-engine': '0.2.0',
    '@types/node': '^24.10.4',
    typescript: '^5.9.3',
  };

  // Every workspace `@internal/*` package becomes a pnpm override pointing
  // at its tarball so transitive resolution stays within the cache, never
  // reaching the public registry. The presence of this block does not mean
  // every package is installed — only ones reached from the dep graph are
  // unpacked into `node_modules`. Isolated linker still hides them from the
  // user's top-level `node_modules` unless they're a direct dep.
  const overrides: Record<string, string> = {};
  for (const [name, tarball] of tarballs.byName) {
    overrides[name] = `file:${tarball}`;
  }
  pkg.pnpm = { ...(pkg.pnpm ?? {}), overrides };

  writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
}

function requireTarball(tarballs: PackedTarballs, name: string): string {
  const path = tarballs.byName.get(name);
  if (path === undefined) {
    throw new Error(
      `prepareWorkspaceTarballs() missing required tarball for "${name}". ` +
        'Did the workspace stop publishing it?',
    );
  }
  return path;
}

function writeIsolatedNpmrc(dir: string): void {
  const contents = [
    'node-linker=isolated',
    'auto-install-peers=true',
    'strict-peer-dependencies=false',
    'prefer-workspace-packages=false',
    // The scratch project is outside the workspace, so it does not inherit
    // the repo's release-age exemption for first-party Prisma packages.
    'minimum-release-age-exclude[]=@prisma/cli-engine',
    // Side-load the pnpm store next to the tarball cache so the encoded
    // relative path stays short (avoids ENAMETOOLONG under deep worktrees).
    `store-dir=${PNPM_STORE_DIR}`,
    '',
  ].join('\n');
  writeFileSync(join(dir, '.npmrc'), contents, 'utf-8');
}

/**
 * Ensures the tmpdir parent exists (e.g. on systems where `os.tmpdir()`
 * points at a path that doesn't pre-exist for the test user). Exported for
 * symmetry with the writeMinimalPackageJson helper above.
 */
export function ensureTmpdir(): void {
  mkdirSync(tmpdir(), { recursive: true });
}

// --- Journey step primitives -----------------------------------------------
//
// Each primitive corresponds to one observable step the user takes after the
// scaffold is in place. They all funnel through `runStep`, which spawns a
// subprocess in the project tmpdir, with `DATABASE_URL` already injected if
// `attachDatabase` was called.

const DATABASE_URL_FILE = '.env';

/**
 * Writes a `.env` file inside the project so that the scaffolded
 * `prisma.config.ts` (which uses `dotenv/config`) picks up the
 * connection string when emit/dbInit/runtime are invoked.
 */
export function attachDatabase(project: JourneyProject, connectionString: string): void {
  const contents = `DATABASE_URL=${connectionString}\n`;
  writeFileSync(join(project.dir, DATABASE_URL_FILE), contents, 'utf-8');
}

/**
 * Emits the contract. The user-facing bin is the unified `prisma` CLI
 * (published from the prisma-cli repo), so journey steps invoke the
 * workspace-built engine bin in the project directory instead of
 * `pnpm exec prisma`.
 */
export async function emitContract(project: JourneyProject): Promise<StepResult> {
  return runStep(project, ['node', CLI_BIN, 'contract', 'emit']);
}

/**
 * Runs `db init`. Retained as a primitive for callers that
 * want the single-shot provisioning path; the journey itself drives
 * the schema in via `migrationPlan` + `migrationApply`.
 */
export async function dbInit(project: JourneyProject): Promise<StepResult> {
  return runStep(project, ['node', CLI_BIN, 'db', 'init']);
}

/**
 * Runs `prisma migration plan --name <name>`. On a fresh scaffold
 * this materialises `migrations/app/<timestamp>_<name>/` with a draft
 * `migration.ts` describing the create-from-scratch operations. The
 * caller is responsible for self-emitting that draft (via
 * `selfEmitLatestMigration`) and then running `migrationApply`.
 */
export async function migrationPlan(project: JourneyProject, name: string): Promise<StepResult> {
  return runStep(project, ['node', CLI_BIN, 'migration', 'plan', '--name', name]);
}

/**
 * Self-emits the most recently planned migration package by executing
 * its `migration.ts` directly via Node's native type stripping. The
 * draft module calls `MigrationCLI.run(import.meta.url, …)`, which
 * serialises the ops to `ops.json` and finalises `migration.json`.
 *
 * The CLI flow used to do this implicitly inside `migration plan`; it
 * is now a separate user-driven step, so the journey performs it
 * explicitly here.
 */
export async function selfEmitLatestMigration(project: JourneyProject): Promise<StepResult> {
  const dir = findLatestAppMigrationDir(project);
  if (dir === null) {
    return {
      command: 'self-emit latest migration',
      exitCode: 1,
      stdout: '',
      stderr: `No migration directory found under ${join(project.dir, 'migrations/app')}`,
    };
  }
  // Running the migration.ts module *is* the emit step — the
  // `MigrationCLI.run(import.meta.url, M)` call serializes the class's
  // operations into `ops.json` next to the file. The CLI only accepts
  // `--help`, `--dry-run`, `--config`; no positional verb.
  const migrationTs = join(dir, 'migration.ts');
  return runStep(project, [
    'node',
    '--env-file-if-exists=.env',
    '--experimental-strip-types',
    '--no-warnings=ExperimentalWarning',
    migrationTs,
  ]);
}

/**
 * Runs `prisma migrate`. Applies every pending migration
 * to the live database — the mongo planner's missing-`createCollection`
 * seam (TML-2486) surfaces here when the bug is present.
 */
export async function migrationApply(project: JourneyProject): Promise<StepResult> {
  return runStep(project, ['node', CLI_BIN, 'migrate']);
}

/**
 * Returns the absolute path of the newest migration directory under
 * `migrations/app/` in the project, or `null` if none exists.
 */
function findLatestAppMigrationDir(project: JourneyProject): string | null {
  const appDir = join(project.dir, 'migrations/app');
  if (!existsSync(appDir)) return null;
  const entries = readdirSync(appDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== 'refs')
    .sort();
  const latest = entries[entries.length - 1];
  return latest === undefined ? null : join(appDir, latest);
}

/**
 * Writes a TypeScript file into the project and executes it via Node's
 * native type stripping (Node 24+). This is the "bolt user code on top"
 * step — the surface where TML-2487 (missing ObjectId re-export) and
 * TML-2314 (missing control re-export) materialise.
 */
export async function runUserCode(
  project: JourneyProject,
  relativePath: string,
  source: string,
): Promise<StepResult> {
  const target = join(project.dir, relativePath);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, source, 'utf-8');
  return runStep(project, [
    'node',
    '--env-file-if-exists=.env',
    '--experimental-strip-types',
    '--no-warnings=ExperimentalWarning',
    relativePath,
  ]);
}

async function runStep(project: JourneyProject, args: readonly string[]): Promise<StepResult> {
  if (args.length === 0) {
    throw new Error('runStep requires a non-empty command');
  }
  const [bin, ...rest] = args;
  if (bin === undefined) {
    throw new Error('runStep requires a binary');
  }
  const result = await runExec(bin, rest, project.dir);
  return { ...result, command: args.join(' ') };
}
