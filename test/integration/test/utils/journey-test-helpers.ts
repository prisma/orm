/**
 * Journey test helpers for CLI e2e scenario tests.
 *
 * Each journey is a single `it()` block that runs multiple CLI commands sequentially
 * against a shared database. These helpers encapsulate the command execution pattern
 * so journey tests stay concise and readable.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { EngineEvent, PresentedResult, StreamEvent } from '@prisma/cli-engine';
import type { Diagnostic } from '@prisma/cli-engine/protocol';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { isAbsolute, join } from 'pathe';
import { afterAll, beforeAll } from 'vitest';

import {
  runOnEngine as runCommandOnEngine,
  runMigrationFile,
  writeProjectManifest,
} from './cli-test-helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a single CLI command execution within a journey step. */
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Options for setting up a journey test directory. */
export interface JourneySetupOptions {
  /** Database connection string (from createDevDatabase). */
  connectionString?: string;
  /** Function to create a temp directory (from withTempDir). */
  createTempDir: () => string;
  /** Which contract source mode the config should use. */
  contractMode?: 'ts' | 'psl';
}

/** Context object returned by setupJourney and used by all run* helpers. */
export interface JourneyContext {
  testDir: string;
  configPath: string;
  outputDir: string;
}

// Re-export timeouts so journey tests can import from a single module.
export { timeouts };

// ---------------------------------------------------------------------------
// Database lifecycle
// ---------------------------------------------------------------------------

/**
 * Registers `beforeAll` / `afterAll` hooks that create and tear down a dev database.
 * Returns a getter for the connection string (available after `beforeAll` runs).
 *
 * Optionally accepts an `onReady` callback that runs inside `beforeAll` with the
 * connection string — useful for seeding the database with tables / data.
 *
 * @example
 * ```ts
 * const db = useDevDatabase();
 * it('works', async () => {
 *   const ctx = setupJourney({ connectionString: db.connectionString, createTempDir });
 * });
 * ```
 *
 * @example
 * ```ts
 * const db = useDevDatabase({ onReady: (cs) => withClient(cs, c => c.query(SQL)) });
 * ```
 */
export function useDevDatabase(options?: {
  onReady?: (connectionString: string) => Promise<unknown>;
}): { readonly connectionString: string } {
  let connectionString = '';
  let close: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const db = await createDevDatabase();
    connectionString = db.connectionString;
    close = db.close;
    await options?.onReady?.(connectionString);
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await close();
  });

  return {
    get connectionString() {
      return connectionString;
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const JOURNEY_FIXTURES_DIR = join(
  __dirname,
  '../fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys',
);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Sets up a journey test directory with the base contract and config.
 * The config's `{{DB_URL}}` placeholder is replaced with the connection string.
 */
export function setupJourney(options: JourneySetupOptions): JourneyContext {
  const { connectionString, createTempDir, contractMode = 'ts' } = options;

  const testDir = createTempDir();
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(testDir, 'migrations'), { recursive: true });

  if (contractMode === 'psl') {
    copyFileSync(
      join(JOURNEY_FIXTURES_DIR, 'contract-base.prisma'),
      join(testDir, 'contract.prisma'),
    );
  } else {
    copyFileSync(join(JOURNEY_FIXTURES_DIR, 'contract-base.ts'), join(testDir, 'contract.ts'));
  }

  // Copy and process config
  const configFileName = connectionString
    ? contractMode === 'psl'
      ? 'prisma.config.with-db.psl.ts'
      : 'prisma.config.with-db.ts'
    : 'prisma.config.ts';
  let configContent = readFileSync(join(JOURNEY_FIXTURES_DIR, configFileName), 'utf-8');
  if (connectionString) {
    configContent = configContent.replace(/\{\{DB_URL\}\}/g, () => connectionString);
  }
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(configPath, configContent, 'utf-8');

  // The journey's project says which import root it is on, rather than
  // inheriting the fixture app's. These journeys drive the CLI against the
  // workspace packages and assert the workspace names in what it writes, so
  // the manifest names no published package — which is what tells emission to
  // leave every specifier as authored. A journey that is specifically about
  // facade behaviour overwrites this with a manifest of its own.
  writeProjectManifest(testDir);

  return { testDir, configPath, outputDir };
}

// ---------------------------------------------------------------------------
// Contract fixtures
// ---------------------------------------------------------------------------

/**
 * All available contract fixture files, keyed by variant name.
 * Add new fixtures here — `ContractVariant` and `swapContract` derive from this automatically.
 */
export const contractFixtures = {
  'contract-base': join(JOURNEY_FIXTURES_DIR, 'contract-base.ts'),
  'contract-additive': join(JOURNEY_FIXTURES_DIR, 'contract-additive.ts'),
  'contract-additive-required': join(JOURNEY_FIXTURES_DIR, 'contract-additive-required.ts'),
  'contract-additive-required-name': join(
    JOURNEY_FIXTURES_DIR,
    'contract-additive-required-name.ts',
  ),
  'contract-destructive': join(JOURNEY_FIXTURES_DIR, 'contract-destructive.ts'),
  'contract-add-table': join(JOURNEY_FIXTURES_DIR, 'contract-add-table.ts'),
  'contract-v3': join(JOURNEY_FIXTURES_DIR, 'contract-v3.ts'),
  'contract-phone': join(JOURNEY_FIXTURES_DIR, 'contract-phone.ts'),
  'contract-bio': join(JOURNEY_FIXTURES_DIR, 'contract-bio.ts'),
  'contract-phone-bio': join(JOURNEY_FIXTURES_DIR, 'contract-phone-bio.ts'),
  'contract-avatar': join(JOURNEY_FIXTURES_DIR, 'contract-avatar.ts'),
  'contract-all': join(JOURNEY_FIXTURES_DIR, 'contract-all.ts'),
  'contract-unique-email': join(JOURNEY_FIXTURES_DIR, 'contract-unique-email.ts'),
  'contract-typechange-text': join(JOURNEY_FIXTURES_DIR, 'contract-typechange-text.ts'),
  'contract-typechange-int': join(JOURNEY_FIXTURES_DIR, 'contract-typechange-int.ts'),
  'contract-nullable-name': join(JOURNEY_FIXTURES_DIR, 'contract-nullable-name.ts'),
  'contract-nullable-name-required': join(
    JOURNEY_FIXTURES_DIR,
    'contract-nullable-name-required.ts',
  ),
  'contract-expression-authored': join(JOURNEY_FIXTURES_DIR, 'contract-expression-authored.ts'),
} as const;

export type ContractVariant = keyof typeof contractFixtures;

export const pslContractFixtures = {
  'contract-base': join(JOURNEY_FIXTURES_DIR, 'contract-base.prisma'),
  'contract-additive': join(JOURNEY_FIXTURES_DIR, 'contract-additive.prisma'),
  'contract-composite-pk': join(JOURNEY_FIXTURES_DIR, 'contract-composite-pk.prisma'),
  'contract-index-upgrade': join(JOURNEY_FIXTURES_DIR, 'contract-index-upgrade.prisma'),
  'contract-expression-authored': join(JOURNEY_FIXTURES_DIR, 'contract-expression-authored.prisma'),
  'contract-expression-authored-renamed': join(
    JOURNEY_FIXTURES_DIR,
    'contract-expression-authored-renamed.prisma',
  ),
  'contract-expression-authored-editedbody': join(
    JOURNEY_FIXTURES_DIR,
    'contract-expression-authored-editedbody.prisma',
  ),
  'contract-rls-adopted': join(JOURNEY_FIXTURES_DIR, 'contract-rls-adopted.prisma'),
  'contract-rls-wire': join(JOURNEY_FIXTURES_DIR, 'contract-rls-wire.prisma'),
} as const;

export type PslContractVariant = keyof typeof pslContractFixtures;

/**
 * Swaps the active contract in the test directory to a different variant.
 * Copies the variant file over `contract.ts` so the config picks it up on next emit.
 */
export function swapContract(ctx: JourneyContext, variant: ContractVariant): void {
  const src = contractFixtures[variant];
  const dest = join(ctx.testDir, 'contract.ts');
  copyFileSync(src, dest);
}

/**
 * Swaps the active PSL contract in the test directory to a different variant.
 * Copies the variant file over `contract.prisma` so the PSL-backed config picks it up.
 */
export function swapPslContract(ctx: JourneyContext, variant: PslContractVariant): void {
  const src = pslContractFixtures[variant];
  const dest = join(ctx.testDir, 'contract.prisma');
  copyFileSync(src, dest);
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

/** Options for controlling the test environment when running a CLI command. */
export interface RunCommandOptions {
  /** Simulate piped stdout (isTTY=false) to test auto-JSON forwarding. Default: true (interactive). */
  readonly isTTY?: boolean;
}

/**
 * What a step run through the engine reports. A superset of
 * {@link CommandResult}, so a wrapper can move onto the engine without every
 * journey that calls it changing at once.
 */
export interface EngineCommandResult extends CommandResult {
  readonly events: readonly EngineEvent[];
  readonly json: readonly StreamEvent[];
  readonly presented: PresentedResult<unknown> | undefined;
}

/** Runs one journey step through the engine's own harness. */
export async function runOnEngine(
  ctx: JourneyContext,
  argv: readonly string[],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runCommandOnEngine(ctx, argv, options);
}

// ---------------------------------------------------------------------------
// Command runners (one per CLI command)
// ---------------------------------------------------------------------------

export async function runContractEmit(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['contract', 'emit', ...extraArgs], options);
}

export async function runContractInfer(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['contract', 'infer', ...extraArgs], options);
}

export async function runDbInit(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['db', 'init', ...extraArgs], options);
}

export async function runDbUpdate(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['db', 'update', ...extraArgs], options);
}

/**
 * What `db update` asks the user to type before it destroys anything: the name
 * of the connected database, which for these Postgres-backed tests is the
 * database segment of the connection URL. A run that means to accept data loss
 * passes it as `--confirm`, because `--yes` cannot grant a consent.
 */
export function consentTokenFor(connectionString: string): string {
  const parsed = new URL(connectionString);
  const name = parsed.pathname.split('/').filter((segment) => segment.length > 0)[0];
  if (name === undefined) {
    throw new Error(`Connection URL names no database: ${connectionString}`);
  }
  return decodeURIComponent(name);
}

export async function runDbVerify(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['db', 'verify', ...extraArgs], options);
}

export async function runDbSign(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['db', 'sign', ...extraArgs], options);
}

export async function runDbSchema(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['db', 'schema', ...extraArgs], options);
}

export async function runMigrationPlan(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['migration', 'plan', ...extraArgs], options);
}

export async function runMigrationNew(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['migration', 'new', ...extraArgs], options);
}

export async function runMigrate(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['db', 'migrate', ...extraArgs], options);
}

export async function runMigrationStatus(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['migration', 'status', ...extraArgs], options);
}

export async function runMigrationShow(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['migration', 'show', ...extraArgs], options);
}

export async function runMigrationLog(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['migration', 'log', ...extraArgs], options);
}

export async function runMigrationList(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['migration', 'list', ...extraArgs], options);
}

export async function runMigrationGraph(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['migration', 'graph', ...extraArgs], options);
}

export async function runMigrationCheck(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['migration', 'check', ...extraArgs], options);
}

// The generator emits `import endContract from '<specifier>' with { type: "json" };`
// (double-quoted attribute value via JSON.stringify), where `<specifier>` is
// the contract snapshot store path (e.g. `../../snapshots/<hex>/contract.json`).
// Capture the specifier so the injected block re-imports the same store entry
// regardless of the migration package's depth. Match either quote style so
// the helper is robust to formatting.
const END_CONTRACT_JSON_IMPORT_RE =
  /import endContract from '([^']+)' with \{ type: ["']json["'] \};\r?\n/;

// The generator's class header carries the `<Start, End>` / `<never, End>`
// generics (post TML-2892). Match the header up to the opening brace.
const MIGRATION_CLASS_HEADER_RE = /export default class M extends Migration(?:<[^>]*>)? \{/;

/**
 * Planner scaffolds import the end contract from its `migrations/snapshots/<hex>/contract.json`
 * store entry as `endContract` and derive their from/to from it via the
 * `Migration` base. This helper rewrites the scaffold for the journey test's
 * runtime apply: it drops the raw-JSON import, deserializes the contract
 * (runtime SQL qualification needs a hydrated Postgres schema namespace with
 * `qualifyTable`), and wires a `db = sql(...)` the filled-in dataTransform
 * closures use. The deserialized contract is bound back to `endContract`, so
 * the scaffold's `endContractJson = endContract` field still resolves (and
 * the base still derives `describe()` from its `storage.storageHash`).
 */
export function injectMigrationSqlDbSetup(scaffold: string): string {
  const match = END_CONTRACT_JSON_IMPORT_RE.exec(scaffold);
  const endContractSpecifier = match?.[1];
  if (endContractSpecifier === undefined) {
    throw new Error(
      'injectMigrationSqlDbSetup: scaffold does not contain the expected ' +
        '`import endContract from \'<specifier>\' with { type: "json" };` line — ' +
        'the CLI-emitted scaffold shape changed.',
    );
  }
  const block = [
    `import endContractJson from '${endContractSpecifier}' with { type: 'json' };`,
    `import { PostgresContractSerializer } from '@internal/target-postgres/runtime';`,
    `import postgresAdapter from '@internal/adapter-postgres/runtime';`,
    `import { sql } from '@internal/sql-builder/runtime';`,
    `import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';`,
    `import postgresTarget from '@internal/target-postgres/runtime';`,
    '',
    'const endContract = new PostgresContractSerializer().deserializeContract(endContractJson);',
    '',
    'const db = sql({',
    '  context: createExecutionContext({',
    '    contract: endContract,',
    '    stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),',
    '  }),',
    '});',
    '',
  ].join('\n');
  return scaffold
    .replace(END_CONTRACT_JSON_IMPORT_RE, '')
    .replace(MIGRATION_CLASS_HEADER_RE, (header) => `${block}${header}`);
}

/**
 * Runs a migration package's `migration.ts` in-process so it writes its own
 * `ops.json` and attested `migration.json` into the package directory
 * (self-emission; see {@link runMigrationFile}).
 *
 * Accepts a trailing `--dir <path>` pair (relative to `ctx.testDir`) naming
 * the migration package whose `migration.ts` to run. Any other arguments are
 * forwarded to the migration-file CLI so tests can pass flags like
 * `--dry-run`.
 */
export async function selfEmitMigration(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  const args = [...extraArgs];
  const dirIdx = args.indexOf('--dir');
  if (dirIdx < 0 || dirIdx === args.length - 1) {
    throw new Error(
      'selfEmitMigration requires `--dir <migration-dir>` so we know which migration.ts to execute',
    );
  }
  const dirArg = args[dirIdx + 1]!;
  args.splice(dirIdx, 2);

  const migrationTs = isAbsolute(dirArg)
    ? join(dirArg, 'migration.ts')
    : join(ctx.testDir, dirArg, 'migration.ts');
  return runMigrationFile(migrationTs, args, ctx.testDir);
}

/**
 * Runs `migration plan` (which scaffolds a draft migration.ts), then runs
 * that migration.ts in-process so it writes its own ops.json and
 * migration.json (self-emission; see {@link runMigrationFile}).
 *
 * Returns the plan result (so JSON callers still see the plan's stdout). If
 * plan fails, the self-emit is skipped. If the self-emit fails, the returned
 * result carries that failure via `exitCode`/`stderr`.
 */
export async function planMigrationAndSelfEmit(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<EngineCommandResult> {
  const planResult = await runMigrationPlan(ctx, extraArgs);
  if (planResult.exitCode !== 0) return planResult;
  const latest = getLatestMigrationDir(ctx);
  if (!latest) return planResult;
  const emitResult = await selfEmitMigration(ctx, ['--dir', `migrations/app/${latest}`]);
  if (emitResult.exitCode !== 0) {
    return {
      ...planResult,
      exitCode: emitResult.exitCode,
      stderr: `${planResult.stderr}\n[planMigrationAndSelfEmit] migration.ts self-emit failed (exit ${emitResult.exitCode}):\n${emitResult.stderr}`,
    };
  }
  return planResult;
}

export async function runRef(
  ctx: JourneyContext,
  subcommandArgs: readonly string[],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['migration', 'ref', ...subcommandArgs], options);
}

/**
 * Runs `contract emit` against a config file the test wrote itself — including
 * files that do not evaluate, which settle as the run's error rather than
 * failing the harness.
 */
export async function runContractEmitWithConfig(
  testDir: string,
  configPath: string,
  extraArgs: readonly string[] = [],
): Promise<EngineCommandResult> {
  return runCommandOnEngine({ testDir, configPath }, ['contract', 'emit', ...extraArgs]);
}

export async function runFormat(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['contract', 'format', ...extraArgs], options);
}

/**
 * Runs a command with explicit --db flag (for connection error tests).
 */
export async function runDbVerifyWithDb(
  ctx: JourneyContext,
  dbUrl: string,
  extraArgs: readonly string[] = [],
): Promise<EngineCommandResult> {
  return runOnEngine(ctx, ['db', 'verify', '--db', dbUrl, ...extraArgs]);
}

// ---------------------------------------------------------------------------
// JSON parsing helper
// ---------------------------------------------------------------------------

/**
 * The `--json` document a step produced. A step run through the engine
 * carries it as the presented result when the handler presented; a step that
 * settled without presenting (a config or orchestration error) carries the
 * document in the terminal `result` frame's envelope — under `result` when
 * the command completed and under `error` when it did not.
 */
export function parseJsonOutput<T = Record<string, unknown>>(result: EngineCommandResult): T {
  if (result.presented !== undefined) {
    return (result.presented.presentation.json ?? result.presented.data) as T;
  }
  const terminal = result.json.at(-1);
  if (terminal === undefined || terminal.kind !== 'result') {
    throw new Error(
      `Step produced no terminal result frame (exit ${result.exitCode}):\n${result.stderr}`,
    );
  }
  return (terminal.envelope.ok ? terminal.envelope.result : terminal.envelope.error) as T;
}

/**
 * The document an engine-run step presented — what `--json` would print inside
 * the result frame — without going back through the frame stream.
 */
export function engineDocument<T = Record<string, unknown>>(run: EngineCommandResult): T {
  const presented = run.presented;
  if (presented === undefined) {
    throw new Error(`Step never presented a result (exit ${run.exitCode}):\n${run.stderr}`);
  }
  return presented.data as T;
}

/**
 * The dotted codes of the findings an engine-run step carried on its envelope.
 * Throws on a step that errored rather than reporting no findings — an empty
 * list has to mean "settled with none", or `toEqual([])` would pass against a
 * run that never presented at all.
 */
export function engineDiagnosticCodes(run: EngineCommandResult): readonly string[] {
  const presented = run.presented;
  if (presented === undefined) {
    throw new Error(`Step never presented a result (exit ${run.exitCode}):\n${run.stderr}`);
  }
  return presented.diagnostics.map((diagnostic) => diagnostic.code);
}

export { EMPTY_CONTRACT_HASH };

export interface MigrationStatusMigrationJson {
  readonly status: 'applied' | 'pending' | null;
  readonly name: string;
  readonly hash: string;
  readonly fromContract: string | null;
  readonly toContract: string;
}

export interface MigrationStatusSpaceJson {
  readonly space: string;
  readonly currentContract: string | null;
  readonly targetContract: string;
  readonly migrations: readonly MigrationStatusMigrationJson[];
}

export interface MigrationStatusDiagnosticJson {
  readonly code: string;
  readonly message: string;
  readonly severity?: string;
  readonly hints?: readonly string[];
  readonly ref?: string;
  readonly invariants?: readonly string[];
}

export interface MigrationStatusJson {
  readonly ok: true;
  readonly spaces: readonly MigrationStatusSpaceJson[];
  readonly summary: string;
  readonly diagnostics?: readonly MigrationStatusDiagnosticJson[];
}

export function readEmittedContractStorageHash(ctx: JourneyContext): string {
  const contractJson = JSON.parse(readFileSync(join(ctx.outputDir, 'contract.json'), 'utf-8')) as {
    storage: { storageHash: string };
  };
  return contractJson.storage.storageHash;
}

/**
 * The primary error an errored engine run settled with. An errored run
 * presents nothing, so its envelope is read from the terminal stream frame
 * rather than from a presented document.
 */
export function engineError(result: EngineCommandResult): Diagnostic | undefined {
  const terminal = result.json.at(-1);
  if (terminal === undefined || terminal.kind !== 'result' || terminal.envelope.ok) {
    return undefined;
  }
  return terminal.envelope.error;
}

export function parseMigrationStatusJson(result: EngineCommandResult): MigrationStatusJson {
  return parseJsonOutput<MigrationStatusJson>(result);
}

export function migrationStatusAppSpace(
  json: MigrationStatusJson,
  spaceId = 'app',
): MigrationStatusSpaceJson {
  const space = json.spaces.find((entry) => entry.space === spaceId);
  if (space === undefined) {
    throw new Error(`status JSON has no space ${spaceId}`);
  }
  return space;
}

// ---------------------------------------------------------------------------
// Migration directory helpers
// ---------------------------------------------------------------------------

/**
 * Path of the app subspace's migrations directory under the journey
 * test root (`migrations/app/`).
 */
function appMigrationsDir(ctx: JourneyContext): string {
  return join(ctx.testDir, 'migrations', 'app');
}

/**
 * Returns sorted list of migration directory names in the journey's
 * `migrations/app/` dir (the app subspace).
 */
export function getMigrationDirs(ctx: JourneyContext): string[] {
  const migrationsDir = appMigrationsDir(ctx);
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir)
    .filter((d) => !d.startsWith('.') && d !== 'refs')
    .filter((d) => statSync(join(migrationsDir, d)).isDirectory())
    .sort();
}

/**
 * Returns the most recently created migration directory name (by mtime).
 *
 * Mtime-based selection is more robust than alphabetical sorting: two
 * migrations planned in the same minute share the `YYYYMMDDTHHMM_` prefix,
 * and alphabetical tie-break falls through to the slug. A newly-planned
 * migration whose slug sorts earlier than an existing sibling would be
 * mis-identified as "not the latest" if we just used `sort().at(-1)`. The
 * on-disk mtime always reflects the actual creation order.
 */
/**
 * The newest migration directory's name — what a user reads out of
 * `migrations/app/` to continue planning from the tip (`--from <dir>`
 * resolves to that migration's destination contract). Throws when the
 * journey has no migrations yet, so call sites can pass it straight into
 * argv.
 */
export function latestMigrationDirName(ctx: JourneyContext): string {
  const latest = getLatestMigrationDir(ctx);
  if (latest === undefined) {
    throw new Error('latestMigrationDirName: the journey has no migration directories yet');
  }
  return latest;
}

export function getLatestMigrationDir(ctx: JourneyContext): string | undefined {
  const dirs = getMigrationDirs(ctx);
  if (dirs.length === 0) return undefined;
  const migrationsDir = appMigrationsDir(ctx);
  const createdAtOf = (dir: string): string => {
    const manifestPath = join(migrationsDir, dir, 'migration.json');
    if (!existsSync(manifestPath)) return '';
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { createdAt?: string };
    return manifest.createdAt ?? '';
  };
  // Newest by the manifest's own createdAt (directory mtime ties on coarse
  // filesystems, and the minute-precision dir-name prefix cannot break a
  // same-minute tie); equal timestamps fall back to the lexicographically
  // last dir name so the choice is deterministic either way.
  let newest = dirs[0]!;
  let newestCreatedAt = createdAtOf(newest);
  for (let i = 1; i < dirs.length; i++) {
    const dir = dirs[i]!;
    const createdAt = createdAtOf(dir);
    if (createdAt > newestCreatedAt || (createdAt === newestCreatedAt && dir > newest)) {
      newestCreatedAt = createdAt;
      newest = dir;
    }
  }
  return newest;
}

// ---------------------------------------------------------------------------
// SQL helper
// ---------------------------------------------------------------------------

/**
 * Executes raw SQL against the journey's database using connect-execute-disconnect.
 * Respects PGlite's single-connection constraint.
 */
export async function sql(
  connectionString: string,
  query: string,
  params?: unknown[],
): Promise<{ rows: Record<string, unknown>[] }> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(query, params);
    return { rows: result.rows as Record<string, unknown>[] };
  });
}

/**
 * Adds pgvector to a journey project's config, as a user declaring an
 * extension would.
 *
 * Lives here rather than in the test that uses it because it edits the config
 * this module wrote, by matching the import line the fixture template carries.
 * The two have to agree on that line's exact text, so they belong together.
 */
export function declarePgvectorExtension(ctx: JourneyContext): void {
  const familyImport = "import sql from '@internal/family-sql/control';";
  const config = readFileSync(ctx.configPath, 'utf-8');
  const next = config
    .replace(
      familyImport,
      `${familyImport}\nimport pgvector from '@internal/extension-pgvector/control';`,
    )
    .replace('extensions: []', 'extensions: [pgvector]');
  writeFileSync(ctx.configPath, next);
}
