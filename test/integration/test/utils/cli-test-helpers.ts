import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadOrmConfig, ormCommandFamily } from '@internal/cli';
import { MigrationCLI } from '@internal/cli/migration-cli';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import type { EngineEvent, MountedTree, PresentedResult, StreamEvent } from '@prisma/cli-engine';
import { createTestCli, type TestCli } from '@prisma/cli-engine/testing';
import { afterEach, beforeEach } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Use a shared fixture package directory that has the necessary dependencies
// This allows jiti to resolve workspace packages when loading config files
// The fixture app can be used by any CLI test that needs to load config files
export const fixtureAppDir = join(__dirname, '../fixtures/cli/cli-e2e-test-app');
export const integrationFixtureAppDir = join(__dirname, '../fixtures/cli/cli-integration-test-app');

/** What a command run through the engine's harness reports back. */
export interface EngineRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly events: readonly EngineEvent[];
  readonly json: readonly StreamEvent[];
  readonly presented: PresentedResult<unknown> | undefined;
}

export interface RunOnEngineOptions {
  /** Simulate piped stdout (isTTY=false) to exercise the engine's json auto-selection. */
  readonly isTTY?: boolean;
}

/**
 * Every path segment the family's commands mount under. The shell owns the
 * real group text; the harness only needs the names to exist.
 */
function groupsFor(commands: MountedTree): Record<string, { readonly brief: string }> {
  const names = new Set<string>();
  for (const path of Object.keys(commands)) {
    const segments = path.split(' ');
    for (let index = 1; index < segments.length; index++) {
      names.add(segments.slice(0, index).join(' '));
    }
  }
  return Object.fromEntries([...names].map((name) => [name, { brief: `${name} commands` }]));
}

/**
 * The ORM family mounted the way the real host mounts it: every command at
 * its family key, which spells the unified CLI's mount path. Shared by every
 * helper that builds a test CLI over the family.
 */
export function ormEngineMount(): {
  readonly commands: MountedTree;
  readonly groups: Record<string, { readonly brief: string }>;
} {
  if (cachedMount === undefined) {
    const commands = { ...ormCommandFamily.commands };
    cachedMount = { commands, groups: groupsFor(commands) };
  }
  return cachedMount;
}

let cachedMount:
  | {
      readonly commands: MountedTree;
      readonly groups: Record<string, { readonly brief: string }>;
    }
  | undefined;

/**
 * One `TestCli` per project, keyed by `testDir` + `configPath`. The engine's
 * `loadConfig` hook runs on every invocation that needs config (the same
 * adapter the binary uses), so a step that writes or rewrites the config file
 * is picked up by the next command without rebuilding the harness — and a
 * config that does not evaluate settles as the run's error, exactly as it
 * would for a user. A test that swaps to a whole new project directory gets a
 * fresh harness through the key.
 */
const engineCliCache = new Map<string, TestCli>();

/**
 * Drops every cached harness for a project directory. Called from the
 * temp-dir cleanup paths so a worker does not retain a `TestCli` (and its
 * `loadConfig` closure) for every deleted directory it ever ran against.
 */
export function evictEngineCli(testDir: string): void {
  for (const key of engineCliCache.keys()) {
    if (key.startsWith(`${testDir}\u0000`)) {
      engineCliCache.delete(key);
    }
  }
}

/**
 * Runs one CLI invocation through the engine's own harness. The project
 * directory is passed as `cwd` rather than chdir'ed into, so nothing about
 * the run is process-global.
 */
export async function runOnEngine(
  project: { readonly testDir: string; readonly configPath: string },
  argv: readonly string[],
  options?: RunOnEngineOptions,
): Promise<EngineRunResult> {
  const key = `${project.testDir}\u0000${project.configPath}`;
  let cli = engineCliCache.get(key);
  if (cli === undefined) {
    const { commands, groups } = ormEngineMount();
    cli = createTestCli({
      commandFamilies: [ormCommandFamily],
      commands,
      groups,
      loadConfig: (configPath) =>
        loadOrmConfig({
          cwd: project.testDir,
          configPath: configPath ?? project.configPath,
        }),
    });
    engineCliCache.set(key, cli);
  }

  const run = await cli.run([...argv], {
    cwd: project.testDir,
    isTty: { stdout: options?.isTTY !== false, stderr: options?.isTTY !== false },
  });

  return {
    exitCode: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    events: run.events,
    json: run.json,
    presented: run.presented,
  };
}

/**
 * Pins a generated test project to the workspace import root.
 *
 * Emission reads the nearest manifest to decide which package names generated
 * files carry, so a project without one inherits whichever manifest happens to
 * be above it. The fixture apps declare the published packages, because the
 * journeys' emitted migrations import them and have to resolve — but these
 * suites are not applications. They exercise the CLI against the workspace
 * packages and assert the workspace names in what it writes. A manifest naming
 * no published package says exactly that: emit every specifier as authored.
 *
 * Journey projects, which do stand in for a user's application, write their own
 * manifest naming the one database package they install.
 */
export function writeProjectManifest(testDir: string): void {
  writeFileSync(
    join(testDir, 'package.json'),
    `${JSON.stringify({ name: 'cli-test-project', private: true, type: 'module' }, null, 2)}\n`,
    'utf-8',
  );
}

/**
 * Creates a test directory within the fixture app directory.
 * The fixture app has the necessary dependencies, so jiti can resolve packages.
 */
export function createTestDir(): string {
  const testDir = join(fixtureAppDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  writeProjectManifest(testDir);
  return testDir;
}

/**
 * Creates a test directory within the integration fixture app directory.
 * The fixture app has the necessary dependencies, so jiti can resolve packages.
 */
export function createIntegrationTestDir(): string {
  const testDir = join(
    integrationFixtureAppDir,
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  writeProjectManifest(testDir);
  return testDir;
}

/**
 * Creates a contract.ts file in the given test directory.
 */
export function createContractFile(testDir: string): string {
  const contractPath = join(testDir, 'contract.ts');
  writeFileSync(
    contractPath,
    `import { int4Column, textColumn } from '@repo/test-utils/column-descriptors';
import { defineContract, field, model } from '@internal/postgres/contract-builder';

const contractObj = defineContract({
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
      },
    }).sql({ table: 'user' }),
  },
});

export const contract = {
  ...contractObj,
  extensions: {},
};
`,
    'utf-8',
  );
  return contractPath;
}

/**
 * Sets up a test directory by copying files from a fixture subdirectory.
 * Test directories are subdirectories of cli-e2e-test-app and inherit workspace
 * dependencies from the parent package.json at the root. jiti will resolve workspace
 * packages by walking up to find the parent package.json.
 * Optionally replaces placeholders in config files.
 * Returns paths (cleanup is handled automatically by withTempDir decorator).
 */
export function setupTestDirectoryFromFixtures(
  createTempDir: () => string,
  fixtureSubdir: string,
  configFileName = 'prisma.config.ts',
  replacements?: Record<string, string>,
) {
  const testDir = createTempDir();
  writeProjectManifest(testDir);
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });

  // Copy files from fixture subdirectory
  const fixturesSubdirPath = join(fixtureAppDir, 'fixtures', fixtureSubdir);
  if (!existsSync(fixturesSubdirPath)) {
    throw new Error(`Fixture subdirectory not found: ${fixturesSubdirPath}`);
  }

  // Copy contract.ts if it exists
  const fixtureContractPath = join(fixturesSubdirPath, 'contract.ts');
  if (existsSync(fixtureContractPath)) {
    const contractPath = join(testDir, 'contract.ts');
    copyFileSync(fixtureContractPath, contractPath);
  }

  // Copy precomputed contract.json and contract.d.ts if they exist
  // Note: outputDir was already created above, so no need for mkdirSync here
  const fixtureContractJsonPath = join(fixturesSubdirPath, 'contract.json');
  const fixtureContractDtsPath = join(fixturesSubdirPath, 'contract.d.ts');
  if (existsSync(fixtureContractJsonPath)) {
    const contractJsonPath = join(outputDir, 'contract.json');
    copyFileSync(fixtureContractJsonPath, contractJsonPath);
  }
  if (existsSync(fixtureContractDtsPath)) {
    const contractDtsPath = join(outputDir, 'contract.d.ts');
    copyFileSync(fixtureContractDtsPath, contractDtsPath);
  }

  // Copy and process config file
  const configPath = join(testDir, 'prisma.config.ts');
  const fixtureConfigPath = join(fixturesSubdirPath, configFileName);
  if (existsSync(fixtureConfigPath)) {
    let configContent = readFileSync(fixtureConfigPath, 'utf-8');
    // Replace placeholders if provided
    if (replacements) {
      for (const [key, value] of Object.entries(replacements)) {
        configContent = configContent.replace(new RegExp(key, 'g'), value);
      }
    }
    writeFileSync(configPath, configContent, 'utf-8');
  }

  return { testDir, contractPath: join(testDir, 'contract.ts'), outputDir, configPath };
}

/**
 * Sets up a test directory for integration tests by copying files from a fixture subdirectory.
 * Test directories are subdirectories of cli-integration-test-app and inherit workspace
 * dependencies from the parent package.json at the root. jiti will resolve workspace
 * packages by walking up to find the parent package.json.
 * Optionally replaces placeholders in config files.
 * Returns paths and cleanup function.
 */
export function setupIntegrationTestDirectoryFromFixtures(
  fixtureSubdir: string,
  configFileName = 'prisma.config.ts',
  replacements?: Record<string, string>,
) {
  const testDir = createIntegrationTestDir();
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });

  // Copy files from fixture subdirectory
  const fixturesSubdirPath = join(integrationFixtureAppDir, 'fixtures', fixtureSubdir);
  if (!existsSync(fixturesSubdirPath)) {
    throw new Error(`Fixture subdirectory not found: ${fixturesSubdirPath}`);
  }

  // Copy all .ts files from fixture directory (contract.ts, invalid-contract.ts, etc.)
  // Exclude the config file as it will be processed separately
  const fixtureFiles = readdirSync(fixturesSubdirPath);
  for (const file of fixtureFiles) {
    if (file.endsWith('.ts') && file !== configFileName) {
      const fixtureFilePath = join(fixturesSubdirPath, file);
      const destFilePath = join(testDir, file);
      copyFileSync(fixtureFilePath, destFilePath);
    }
  }

  // Copy and process config file
  const configPath = join(testDir, 'prisma.config.ts');
  const fixtureConfigPath = join(fixturesSubdirPath, configFileName);
  if (existsSync(fixtureConfigPath)) {
    let configContent = readFileSync(fixtureConfigPath, 'utf-8');
    // Replace placeholders if provided
    if (replacements) {
      for (const [key, value] of Object.entries(replacements)) {
        configContent = configContent.replace(new RegExp(key, 'g'), value);
      }
    }
    writeFileSync(configPath, configContent, 'utf-8');
  }

  const cleanup = () => {
    evictEngineCli(testDir);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  };

  return { testDir, contractPath: join(testDir, 'contract.ts'), outputDir, configPath, cleanup };
}

/**
 * Loads a contract from disk (already-emitted artifact).
 * This helper DRYs up the common pattern of loading contracts in e2e tests.
 * The contract type should be specified from the emitted contract.d.ts file.
 */
export function loadContractFromDisk<TContract extends Contract<SqlStorage> = Contract<SqlStorage>>(
  contractJsonPath: string,
): TContract {
  if (!existsSync(contractJsonPath)) {
    throw new Error(`Contract file not found: ${contractJsonPath}`);
  }

  let contractJsonContent: string;
  try {
    contractJsonContent = readFileSync(contractJsonPath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read contract file ${contractJsonPath}: ${message}`);
  }

  let contractJson: Record<string, unknown>;
  try {
    contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse contract JSON from ${contractJsonPath}: ${message}`);
  }

  return new PostgresContractSerializer().deserializeContract(contractJson) as TContract;
}

/**
 * Sets up a test directory with contract.ts file and returns paths.
 * @deprecated Use setupTestDirectoryFromFixtures instead
 */
export function setupTestDirectory(): {
  testDir: string;
  contractPath: string;
  outputDir: string;
  configPath: string;
  cleanup: () => void;
} {
  const testDir = createTestDir();
  const contractPath = createContractFile(testDir);
  const outputDir = join(testDir, 'output');
  const configPath = join(testDir, 'prisma.config.ts');

  const cleanup = () => {
    evictEngineCli(testDir);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  };

  return { testDir, contractPath, outputDir, configPath, cleanup };
}

export interface DbTestFixtureOptions {
  connectionString: string;
  createTempDir: () => string;
  fixtureSubdir: string;
  /** SQL to run before setting up the test directory. If undefined, no SQL is run. */
  schemaSql?: string;
}

/**
 * Sets up a test directory for database CLI e2e tests.
 * Optionally creates a database schema and emits the contract.
 */
export async function setupDbTestFixture(
  options: DbTestFixtureOptions,
): Promise<{ testSetup: ReturnType<typeof setupTestDirectoryFromFixtures>; configPath: string }> {
  const { connectionString, createTempDir, fixtureSubdir, schemaSql } = options;
  const { withClient } = await import('@repo/test-utils');

  // Run schema SQL if provided
  if (schemaSql) {
    await withClient(connectionString, async (client) => {
      await client.query(schemaSql);
    });
  }

  const testSetup = setupTestDirectoryFromFixtures(
    createTempDir,
    fixtureSubdir,
    'prisma.config.with-db.ts',
    { '{{DB_URL}}': connectionString },
  );
  const configPath = testSetup.configPath;

  const emit = await runOnEngine(testSetup, ['contract', 'emit']);
  if (emit.exitCode !== 0) {
    throw new Error(`setupDbTestFixture: contract emit exited ${emit.exitCode}\n${emit.stderr}`);
  }

  return { testSetup, configPath };
}

export function clearDbRefForGreenfieldPlan(testDir: string): void {
  const refsDir = join(testDir, 'migrations', 'app', 'refs');
  if (!existsSync(refsDir)) {
    return;
  }
  for (const name of readdirSync(refsDir)) {
    if (name === 'db.json' || name.startsWith('db.contract.')) {
      rmSync(join(refsDir, name), { force: true });
    }
  }
}

/** What running a `migration.ts` file reports back. */
export interface MigrationFileRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

class CapturingWritable extends Writable {
  private readonly chunks: Buffer[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  get text(): string {
    return Buffer.concat(this.chunks).toString('utf-8');
  }
}

/**
 * Runs a scaffolded `migration.ts` in-process, replacing the old
 * `execFile(tsx, [migration.ts])` pattern. Each spawn paid a node boot, an
 * esbuild transform, and a cold import of the workspace packages — one to
 * three seconds per migration step on CI, multiplied across every journey.
 *
 * Vitest's own transformer imports the file (the `?v=<content-hash>` query
 * defeats the ESM module cache when a test rewrites the same migration.ts),
 * and the module-scope `MigrationCLI.run(import.meta.url, M)` call inside the
 * file no-ops because the file is not the process entrypoint. The helper then
 * invokes `MigrationCLI.run` itself with an argv whose second element is the
 * migration path, which satisfies the entrypoint guard, and with injected
 * capture streams — the same in-process testability surface the CLI package's
 * own tests use.
 *
 * Two process globals are saved and restored around the run, because the
 * migration-file CLI is written for a process it owns: config discovery walks
 * up from `process.cwd()` (so the helper chdirs to `cwd`, exactly where the
 * old spawn pointed the child), and a failing run sets `process.exitCode`
 * (which must not leak into the vitest worker's exit status when a test
 * asserts on a migration failure). Tests within a worker run sequentially
 * under the forks pool, so the temporary chdir cannot interleave with another
 * test.
 */
export async function runMigrationFile(
  migrationTs: string,
  args: readonly string[] = [],
  cwd?: string,
): Promise<MigrationFileRunResult> {
  const content = readFileSync(migrationTs, 'utf-8');
  const version = createHash('sha1').update(content).digest('hex').slice(0, 12);
  const migrationUrl = pathToFileURL(migrationTs).href;
  const module = (await import(`${migrationUrl}?v=${version}`)) as {
    default: Parameters<typeof MigrationCLI.run>[1];
  };
  const stdout = new CapturingWritable();
  const stderr = new CapturingWritable();
  const previousExitCode = process.exitCode;
  const previousCwd = process.cwd();
  try {
    process.chdir(cwd ?? dirname(migrationTs));
    const exitCode = await MigrationCLI.run(migrationUrl, module.default, {
      argv: [process.execPath, migrationTs, ...args],
      stdout,
      stderr,
    });
    return { exitCode, stdout: stdout.text, stderr: stderr.text };
  } finally {
    process.chdir(previousCwd);
    process.exitCode = previousExitCode;
  }
}

/**
 * Decorator that wraps test suites to automatically manage temporary directory cleanup.
 * Creates directories within the fixture app directory so jiti can resolve workspace packages.
 * Sets up `beforeEach` and `afterEach` hooks to track and clean up directories per test.
 *
 * @example
 * ```typescript
 * withTempDir(({ createTempDir }) => {
 *   describe('test suite', () => {
 *     it('test', () => {
 *       const testDir = createTempDir();
 *       // ... use testDir
 *       // Directory is automatically cleaned up after the test
 *     });
 *   });
 * });
 * ```
 */
export function withTempDir(callback: (context: { createTempDir: () => string }) => void): void {
  const tempDirs = new Set<string>();

  beforeEach(() => {
    // Reset the set of directories for each test
    tempDirs.clear();
  });

  afterEach(() => {
    // Clean up all directories created during this test
    for (const dir of tempDirs) {
      try {
        evictEngineCli(dir);
        if (existsSync(dir)) {
          rmSync(dir, { recursive: true, force: true });
        }
      } catch (_error) {
        // Ignore cleanup errors
      }
    }
    tempDirs.clear();
  });

  const createTempDir = (): string => {
    // Create directories within the fixture app so jiti can resolve workspace packages
    const testDir = join(
      fixtureAppDir,
      `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    tempDirs.add(testDir);
    return testDir;
  };

  callback({ createTempDir });
}
