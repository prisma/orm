#!/usr/bin/env npx tsx

/**
 * Record CLI demo SVGs and asciicasts using VHS.
 *
 * Usage:
 *   npx tsx scripts/record.ts                        # Per-command recordings
 *   npx tsx scripts/record.ts --journey <slug>       # Single journey
 *   npx tsx scripts/record.ts --all-journeys         # All journeys (parallel)
 *   npx tsx scripts/record.ts --journey <slug> --mp4 # Also emit MP4 files
 *
 * Per-command mode (default):
 *   Reads `recordings/config.ts` and, for each recording entry:
 *     1. Sets up database state (if needed)
 *     2. Generates a VHS `.tape` file       -> recordings/tapes/<group>/<name>.tape
 *     3. Runs VHS to produce an SVG         -> recordings/svgs/<group>/<name>.svg
 *     4. Runs VHS to produce an asciicast   -> recordings/ascii/<group>/<name>.ascii
 *
 * Journey mode (--journey <slug> or --all-journeys):
 *   Records multi-step user journeys where database state accumulates across
 *   steps (no reset between them). With --all-journeys, each journey gets its
 *   own database and runs in parallel.
 *
 * Options:
 *   --mp4                 Also emit MP4 files (requires ffmpeg on PATH).
 *                         MP4/GIF output requires the configured font installed locally:
 *                           brew install --cask font-jetbrains-mono
 *   --no-cache            Re-record all, bypassing per-recording output cache.
 *
 * Requires:
 *   - `vhs` on PATH       (brew install charmbracelet/tap/vhs)
 *   - CLI built            (pnpm build)
 *   - pnpm install         (workspace packages resolved)
 *   - PostgreSQL instance (for recordings that need a database)
 *     Defaults to postgres://postgres:postgres@127.0.0.1:5433/postgres
 *     (matches root docker-compose.yaml). Override with DATABASE_URL.
 *
 * Note: PGlite (via @prisma/dev) cannot be used here because it only accepts
 * connections from the process that started it. VHS spawns the CLI in a separate
 * process tree, which PGlite rejects. A real PostgreSQL instance is required.
 */

import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  config,
  type Journey,
  type JourneyStep,
  type Recording,
  type StepAction,
} from '../recordings/config';

// --- Paths ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLI_ROOT = resolve(__dirname, '..');
const CLI_BIN = resolve(CLI_ROOT, 'dist', 'cli.js');
const RECORDINGS_DIR = resolve(CLI_ROOT, 'recordings');
const FIXTURES_DIR = join(RECORDINGS_DIR, 'fixtures');
const TAPES_DIR = join(RECORDINGS_DIR, 'tapes');
const SVGS_DIR = join(RECORDINGS_DIR, 'svgs');
const ASCII_DIR = join(RECORDINGS_DIR, 'ascii');
const MP4_DIR = join(RECORDINGS_DIR, 'mp4');
const BIN_DIR = join(RECORDINGS_DIR, '.bin');

/** Whether to also emit MP4 files (set via --mp4 flag). */
let emitMp4 = false;

/** Whether to bypass per-recording cache (set via --no-cache flag). */
let noCache = false;

// --- Per-recording cache ---
//
// Each per-command recording is probed by running the CLI directly (no VHS).
// The output hash is stored in .cache.json. On re-run, if the hash matches
// and output files exist, VHS is skipped for that recording.

const CACHE_FILE = join(RECORDINGS_DIR, '.cache.json');

type CacheMap = Record<string, string>;

function readCache(): CacheMap {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as CacheMap;
  } catch {
    return {};
  }
}

function writeCache(cache: CacheMap): void {
  writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`);
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Runs the CLI command directly (no VHS) and returns stdout.
 * Fast probe to detect whether a recording's CLI output has changed.
 */
function probeCliOutput(command: string, cwd: string): string {
  const args = command.replace(/^prisma\s+/, '');
  try {
    return execFileSync(process.execPath, [CLI_BIN, ...args.split(/\s+/).filter(Boolean)], {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, NO_COLOR: '1', CI: 'true' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

function findMonorepoRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== '/') {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('Could not find monorepo root (pnpm-workspace.yaml)');
}

const MONOREPO_ROOT = findMonorepoRoot(CLI_ROOT);

/**
 * Workspace is created inside the test fixture app so jiti can resolve
 * workspace packages (adapter-postgres, driver-postgres, etc.) when
 * loading prisma.config.ts.
 */
const FIXTURE_APP_DIR = join(MONOREPO_ROOT, 'test/integration/test/fixtures/cli/cli-e2e-test-app');

// --- Test utils (loaded dynamically to avoid adding deps to CLI package) ---

interface DbClient {
  query(sql: string): Promise<unknown>;
}

interface TestUtils {
  withClient<T>(connectionString: string, fn: (client: DbClient) => Promise<T>): Promise<T>;
}

async function loadTestUtils(): Promise<TestUtils> {
  const testUtilsPath = join(MONOREPO_ROOT, 'test/utils/src/exports/index.ts');
  if (!existsSync(testUtilsPath)) {
    throw new Error(
      `test-utils not found at ${testUtilsPath}.\nRun pnpm install from the monorepo root.`,
    );
  }
  const mod = await import(pathToFileURL(testUtilsPath).href);
  return { withClient: mod.withClient };
}

let testUtils: TestUtils;

const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5433/postgres';

// --- Prerequisites ---

function validatePrerequisites(): void {
  try {
    execSync('which vhs', { stdio: 'pipe' });
  } catch {
    throw new Error('vhs not found. Install: brew install charmbracelet/tap/vhs');
  }

  if (!existsSync(CLI_BIN)) {
    throw new Error(`CLI not built. Run 'pnpm build' first.\nExpected: ${CLI_BIN}`);
  }

  if (!existsSync(FIXTURE_APP_DIR)) {
    throw new Error(
      `Fixture app not found at ${FIXTURE_APP_DIR}.\n` +
        'Run pnpm install from the monorepo root first.',
    );
  }
}

// --- Shell environment setup ---

/**
 * Creates a `prisma` executable wrapper in BIN_DIR.
 * If `cwd` is provided, the wrapper cd's there before running the CLI
 * (so the config file is found automatically).
 * Returns the wrapper directory path.
 */
function createCliBinWrapper(name: string, cwd?: string): string {
  const wrapperDir = join(BIN_DIR, name);
  mkdirSync(wrapperDir, { recursive: true });
  const wrapperPath = join(wrapperDir, 'prisma');
  const lines = ['#!/usr/bin/env bash'];
  if (cwd) {
    lines.push(`cd ${cwd}`);
  }
  lines.push(`exec node ${CLI_BIN} "$@"`);
  writeFileSync(wrapperPath, `${lines.join('\n')}\n`);
  chmodSync(wrapperPath, 0o755);
  return wrapperDir;
}

// --- VHS PATH construction ---

/**
 * Builds a minimal PATH for VHS tape files.
 * Only includes the wrapper directory, the Node.js binary directory,
 * and standard system paths. Avoids leaking the developer's full PATH
 * (personal tool installations, editor integrations, etc.) into committed tapes.
 */
function buildVhsPath(wrapperDir: string): string {
  const nodeBinDir = dirname(process.execPath);
  // VHS needs ttyd (and optionally ffmpeg) which live alongside the vhs binary.
  const vhsBinDir = dirname(execSync('which vhs', { encoding: 'utf-8' }).trim());
  const systemPaths = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  // Deduplicate while preserving order
  const parts = [wrapperDir, nodeBinDir, vhsBinDir, ...systemPaths.split(':')];
  return [...new Set(parts)].join(':');
}

// --- VHS tape generation ---

/**
 * Wraps a value in a VHS-compatible quoted string.
 * VHS supports three delimiters (`"`, `'`, `` ` ``) with no escape sequences.
 */
function vhsQuote(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes('`')) return `\`${value}\``;
  if (!value.includes("'")) return `'${value}'`;
  throw new Error(
    `Cannot quote VHS string — value contains all three delimiters (" ' \`): ${value}`,
  );
}

function generateSharedTape(): string {
  const { vhs } = config;
  const lines = [
    `Set Shell ${vhs.shell}`,
    `Set Width ${vhs.width}`,
    `Set FontSize ${vhs.fontSize}`,
    `Set FontFamily ${vhsQuote(vhs.fontFamily)}`,
    `Set Padding ${vhs.padding}`,
    `Set Theme ${vhsQuote(vhs.theme)}`,
    `Set TypingSpeed ${vhs.typingSpeed}`,
    `Set Framerate ${vhs.framerate}`,
    `Set CursorBlink ${vhs.cursorBlink}`,
    `Set WindowBar ${vhs.windowBar}`,
  ];
  return `${lines.join('\n')}\n`;
}

function generateTape(opts: {
  sharedTapePath: string;
  vhsPath: string;
  outputPaths: string[];
  command: string;
  description?: string;
  dbState?: string;
  sleepAfterEnter: string;
  height: number;
  /** If set, a hidden `cd` is emitted before the visible command. */
  cwd?: string;
}): string {
  const lines = [
    `Set Height ${opts.height}`,
    `Source ${vhsQuote(opts.sharedTapePath)}`,
    `Env PATH ${vhsQuote(opts.vhsPath)}`,
  ];
  lines.push(...opts.outputPaths.map((p) => `Output ${vhsQuote(p)}`), '');

  // Pre-write a shell comment describing the scenario + db state before the command.
  // Uses Hide/Show so the comment appears instantly (not typed character-by-character).
  const commentParts = [opts.description, opts.dbState ? `[${opts.dbState}]` : ''].filter(Boolean);
  if (opts.cwd) {
    // Hidden cd + clear so non-wrapper commands (e.g., cat) run in the workspace
    // directory without the cd leaking into visible scrollback.
    lines.push('Hide', `Type ${vhsQuote(`cd ${opts.cwd}`)}`, 'Enter', 'Type "clear"', 'Enter');
    if (commentParts.length > 0) {
      lines.push(`Type ${vhsQuote(`# ${commentParts.join(' ')}`)}`, 'Enter');
    }
    lines.push('Show', 'Sleep 500ms');
  } else if (commentParts.length > 0) {
    lines.push(
      'Hide',
      `Type ${vhsQuote(`# ${commentParts.join(' ')}`)}`,
      'Enter',
      'Show',
      'Sleep 500ms',
    );
  }

  // Split multi-line commands (with \ continuations) into separate Type/Enter pairs
  const commandLines = opts.command.split('\n');
  for (let i = 0; i < commandLines.length; i++) {
    lines.push(`Type ${vhsQuote(commandLines[i]!)}`);
    if (i < commandLines.length - 1) {
      lines.push('Enter');
    }
  }
  lines.push('Sleep 300ms', 'Enter', `Sleep ${opts.sleepAfterEnter}`);

  return `${lines.join('\n')}\n`;
}

// --- Per-journey context ---

/** Encapsulates per-journey state so journeys can run in parallel. */
interface JourneyContext {
  slug: string;
  journey: Journey;
  connectionString: string;
  workspaceDir: string;
  sharedTapePath: string;
}

// --- Database helpers (context-aware) ---

async function resetDatabase(connStr: string): Promise<void> {
  await testUtils.withClient(connStr, async (client) => {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
  });
}

/**
 * Retries until the database accepts a connection.
 * Handles the window where a previous VHS step's connection is being torn down.
 */
async function waitForDb(connStr: string, maxRetries = 10, delayMs = 500): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await testUtils.withClient(connStr, async (client) => {
        await client.query('SELECT 1');
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`Database connection not available after ${maxRetries} retries`);
}

function runCliIn(workspaceDir: string, _connStr: string, args: string[]): void {
  execFileSync(process.execPath, [CLI_BIN, ...args], {
    cwd: workspaceDir,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1', CI: 'true' },
    stdio: 'pipe',
  });
}

// --- Workspace management (context-aware) ---

function setupWorkspace(workspaceDir: string, contractFile: string, connStr: string): void {
  if (existsSync(workspaceDir)) {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
  mkdirSync(workspaceDir, { recursive: true });

  copyFileSync(join(FIXTURES_DIR, contractFile), join(workspaceDir, 'contract.ts'));

  const configTemplate = readFileSync(join(FIXTURES_DIR, 'prisma.config.ts'), 'utf-8');
  writeFileSync(
    join(workspaceDir, 'prisma.config.ts'),
    configTemplate.replace('{{DB_URL}}', connStr),
  );
}

function emitContractIn(workspaceDir: string, connStr: string): void {
  runCliIn(workspaceDir, connStr, [
    'contract',
    'emit',
    '--config',
    join(workspaceDir, 'prisma.config.ts'),
  ]);
}

function initDatabaseIn(workspaceDir: string, connStr: string): void {
  runCliIn(workspaceDir, connStr, [
    'db',
    'init',
    '--config',
    join(workspaceDir, 'prisma.config.ts'),
    '--db',
    connStr,
  ]);
}

// --- Step actions ---

async function executeStepActions(ctx: JourneyContext, actions: StepAction[]): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case 'swap-contract':
        copyFileSync(join(FIXTURES_DIR, action.contract), join(ctx.workspaceDir, 'contract.ts'));
        break;
      case 'emit-contract':
        emitContractIn(ctx.workspaceDir, ctx.connectionString);
        break;
      case 'sql':
        await testUtils.withClient(ctx.connectionString, async (client) => {
          await client.query(action.query);
        });
        break;
    }
  }
}

// --- Database pool ---

/**
 * Creates isolated databases in the Postgres instance for parallel journey recording.
 * Returns connection strings for each database.
 */
async function createDatabasePool(baseConnStr: string, count: number): Promise<string[]> {
  const urls: string[] = [];
  await testUtils.withClient(baseConnStr, async (client) => {
    for (let i = 0; i < count; i++) {
      const dbName = `prisma_rec_${i}`;
      await client.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await client.query(`CREATE DATABASE ${dbName}`);
      const url = new URL(baseConnStr);
      url.pathname = `/${dbName}`;
      urls.push(url.toString());
    }
  });
  return urls;
}

async function destroyDatabasePool(baseConnStr: string, count: number): Promise<void> {
  await testUtils.withClient(baseConnStr, async (client) => {
    for (let i = 0; i < count; i++) {
      await client.query(`DROP DATABASE IF EXISTS prisma_rec_${i}`);
    }
  });
}

// --- Concurrency helper ---

async function runParallel<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]!();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}

// --- Dynamic height measurement ---

const CHROME_PX = 270;

function parseMaxContentY(svg: string): number {
  const frameRe = /<g transform="translate\((\d+),0\)">/g;
  let maxX = 0;
  let lastFrameIdx = 0;
  for (let m = frameRe.exec(svg); m !== null; m = frameRe.exec(svg)) {
    const x = Number.parseInt(m[1]!, 10);
    if (x >= maxX) {
      maxX = x;
      lastFrameIdx = m.index;
    }
  }

  const nextFrame = svg.indexOf('<g transform="translate(', lastFrameIdx + 1);
  const frame = svg.slice(lastFrameIdx, nextFrame > lastFrameIdx ? nextFrame : undefined);

  const yRe = /<text y="([\d.]+)"/g;
  let maxY = 0;
  for (let m = yRe.exec(frame); m !== null; m = yRe.exec(frame)) {
    maxY = Math.max(maxY, Number.parseFloat(m[1]!));
  }
  return maxY;
}

function runVhs(tapePath: string): void {
  execFileSync('vhs', [tapePath], { cwd: CLI_ROOT, stdio: 'pipe' });
}

// --- Record a single per-command recording (legacy mode) ---

// Global connection string used only by legacy per-command recordings.
let legacyConnectionString = '';
const LEGACY_WORKSPACE_DIR = join(FIXTURE_APP_DIR, '.recording-workspace');

async function recordOne(opts: {
  group: string;
  recording: Recording;
  sharedTapePath: string;
  cache: CacheMap;
}): Promise<void> {
  const { group, recording, sharedTapePath, cache } = opts;
  const label = `${group}/${recording.name}`;
  const sleepAfterEnter = recording.sleepAfterEnter ?? config.vhs.sleepAfterEnter;
  const setup = recording.setup ?? 'none';

  // --- Per-recording cache check ---
  if (!noCache) {
    if (setup !== 'none') {
      await prepareForLegacyRecording(recording);
    }
    try {
      const probeCwd = setup !== 'none' ? LEGACY_WORKSPACE_DIR : CLI_ROOT;
      const output = probeCliOutput(recording.command, probeCwd);
      const hash = hashContent(
        [output, JSON.stringify(config.vhs), JSON.stringify(recording)].join('\0'),
      );
      const key = `${group}/${recording.name}`;

      const svgExists = existsSync(join(SVGS_DIR, group, `${recording.name}.svg`));
      const asciiExists = existsSync(join(ASCII_DIR, group, `${recording.name}.ascii`));
      const mp4Ok = !emitMp4 || existsSync(join(MP4_DIR, group, `${recording.name}.mp4`));

      if (cache[key] === hash && svgExists && asciiExists && mp4Ok) {
        console.log(`\n  ${label} (unchanged)`);
        return;
      }
      cache[key] = hash;
    } catch {
      // Probe failed — fall through to full recording
    }
  }

  console.log(`\n  ${label}`);

  const wrapperDir = createCliBinWrapper(
    `${group}-${recording.name}`,
    setup !== 'none' ? LEGACY_WORKSPACE_DIR : undefined,
  );
  const vhsPath = buildVhsPath(wrapperDir);

  const maxHeight = config.vhs.height * 2;
  let height = config.vhs.height;

  if (typeof recording.height === 'number') {
    height = recording.height;
  } else if (recording.height === 'dynamic') {
    console.log('    Probe pass (measuring height)...');
    await prepareForLegacyRecording(recording);

    const probeSvgPath = join(TAPES_DIR, group, `${recording.name}.probe.svg`);
    const probeTapePath = join(TAPES_DIR, group, `${recording.name}.probe.tape`);

    const probeTape = generateTape({
      sharedTapePath: relative(CLI_ROOT, sharedTapePath),
      vhsPath,
      outputPaths: [relative(CLI_ROOT, probeSvgPath)],
      command: recording.command,
      description: recording.description,
      sleepAfterEnter,
      height: maxHeight,
    });
    writeFileSync(probeTapePath, probeTape);
    runVhs(probeTapePath);

    if (existsSync(probeSvgPath)) {
      const svg = readFileSync(probeSvgPath, 'utf-8');
      const maxY = parseMaxContentY(svg);
      height = Math.round(Math.min(Math.max(maxY + CHROME_PX, config.vhs.height), maxHeight));
      console.log(`    Content: ${maxY}px -> height: ${height}px`);
    }

    rmSync(probeSvgPath, { force: true });
    rmSync(probeTapePath, { force: true });
  }

  await prepareForLegacyRecording(recording);

  const outputPaths = [
    relative(CLI_ROOT, join(SVGS_DIR, group, `${recording.name}.svg`)),
    relative(CLI_ROOT, join(ASCII_DIR, group, `${recording.name}.ascii`)),
  ];
  if (emitMp4) {
    mkdirSync(join(MP4_DIR, group), { recursive: true });
    outputPaths.push(relative(CLI_ROOT, join(MP4_DIR, group, `${recording.name}.mp4`)));
  }

  console.log('    Recording...');
  const tapeContent = generateTape({
    sharedTapePath: relative(CLI_ROOT, sharedTapePath),
    vhsPath,
    outputPaths,
    command: recording.command,
    description: recording.description,
    sleepAfterEnter,
    height,
  });

  const tapePath = join(TAPES_DIR, group, `${recording.name}.tape`);
  writeFileSync(tapePath, tapeContent);
  runVhs(tapePath);

  const svgPath = join(SVGS_DIR, group, `${recording.name}.svg`);
  console.log(`    Done → ${relative(process.cwd(), svgPath)}`);
}

async function prepareForLegacyRecording(recording: Recording): Promise<void> {
  const setup = recording.setup ?? 'none';
  if (setup === 'none') return;

  const contractFile = recording.contract ?? 'contract-base.ts';
  await resetDatabase(legacyConnectionString);

  if (setup === 'initialized') {
    setupWorkspace(LEGACY_WORKSPACE_DIR, 'contract-base.ts', legacyConnectionString);
    emitContractIn(LEGACY_WORKSPACE_DIR, legacyConnectionString);
    initDatabaseIn(LEGACY_WORKSPACE_DIR, legacyConnectionString);

    if (contractFile !== 'contract-base.ts') {
      console.log(`    Swap contract -> ${contractFile}`);
      copyFileSync(join(FIXTURES_DIR, contractFile), join(LEGACY_WORKSPACE_DIR, 'contract.ts'));
      emitContractIn(LEGACY_WORKSPACE_DIR, legacyConnectionString);
    }
  } else {
    setupWorkspace(LEGACY_WORKSPACE_DIR, contractFile, legacyConnectionString);
    emitContractIn(LEGACY_WORKSPACE_DIR, legacyConnectionString);
  }
}

// --- Record a journey (multi-step, stateful) ---

async function recordJourney(ctx: JourneyContext): Promise<void> {
  const { slug, journey, connectionString, workspaceDir } = ctx;
  const contractFile = journey.contract ?? 'contract-base.ts';

  console.log(`\n  Journey: ${slug} (${journey.steps.length} steps)`);

  // Set up workspace and database based on precondition
  await resetDatabase(connectionString);
  setupWorkspace(workspaceDir, contractFile, connectionString);

  if (journey.precondition === 'initialized') {
    console.log(`    [${slug}] Precondition: emit + db init`);
    emitContractIn(workspaceDir, connectionString);
    initDatabaseIn(workspaceDir, connectionString);
  }

  // Create output directories
  for (const dir of [TAPES_DIR, SVGS_DIR, ASCII_DIR]) {
    mkdirSync(join(dir, slug), { recursive: true });
  }

  for (const step of journey.steps) {
    await recordJourneyStep(ctx, step);
  }

  console.log(`\n  Journey ${slug} complete`);
}

async function recordJourneyStep(ctx: JourneyContext, step: JourneyStep): Promise<void> {
  const { slug, sharedTapePath, workspaceDir, connectionString } = ctx;
  const name = `${step.ordinal}-${step.slug}`;
  const sleepAfterEnter = step.sleepAfterEnter ?? config.vhs.sleepAfterEnter;
  const height = step.height ?? config.vhs.height;

  console.log(`\n    [${step.ordinal}] ${step.slug}`);
  if (step.description) {
    console.log(`         ${step.description}`);
  }

  // Execute pre-step actions (contract swap, emit, raw SQL)
  if (step.before) {
    await executeStepActions(ctx, step.before);
  }

  const wrapperDir = createCliBinWrapper(`${slug}-${name}`, workspaceDir);
  const vhsPath = buildVhsPath(wrapperDir);

  // Ensure database connection is available before recording
  await waitForDb(connectionString);

  const outputPaths = [
    relative(CLI_ROOT, join(SVGS_DIR, slug, `${name}.svg`)),
    relative(CLI_ROOT, join(ASCII_DIR, slug, `${name}.ascii`)),
  ];
  if (emitMp4) {
    mkdirSync(join(MP4_DIR, slug), { recursive: true });
    outputPaths.push(relative(CLI_ROOT, join(MP4_DIR, slug, `${name}.mp4`)));
  }

  console.log('         Recording...');
  // Non-prisma commands (e.g. cat) need an explicit cd to the workspace
  // because only the prisma wrapper auto-cds there.
  const needsCwd = !step.command.startsWith('prisma');
  const tapeContent = generateTape({
    sharedTapePath: relative(CLI_ROOT, sharedTapePath),
    vhsPath,
    outputPaths,
    command: step.command,
    description: step.description,
    dbState: step.dbState,
    sleepAfterEnter,
    height,
    ...(needsCwd ? { cwd: workspaceDir } : {}),
  });

  const tapePath = join(TAPES_DIR, slug, `${name}.tape`);
  writeFileSync(tapePath, tapeContent);
  runVhs(tapePath);

  const svgPath = join(SVGS_DIR, slug, `${name}.svg`);
  console.log(`         Done → ${relative(process.cwd(), svgPath)}`);
}

// --- CLI argument parsing ---

type ParsedArgs =
  | { mode: 'recordings' }
  | { mode: 'journey'; slug: string }
  | { mode: 'all-journeys' };

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);

  if (args.includes('--all-journeys')) {
    return { mode: 'all-journeys' };
  }

  const journeyIdx = args.indexOf('--journey');

  if (journeyIdx === -1) {
    return { mode: 'recordings' };
  }

  const slug = args[journeyIdx + 1];
  if (!slug || slug.startsWith('--')) {
    const available = Object.keys(config.journeys).join(', ');
    throw new Error(`--journey requires a slug. Available: ${available}`);
  }

  if (!(slug in config.journeys)) {
    const available = Object.keys(config.journeys).join(', ');
    throw new Error(`Unknown journey "${slug}". Available: ${available}`);
  }

  return { mode: 'journey', slug };
}

// --- Cleanup ---

function cleanupWorkspaces(slugs: string[]): void {
  for (const slug of slugs) {
    const dir = join(FIXTURE_APP_DIR, `.recording-workspace-${slug}`);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  if (existsSync(LEGACY_WORKSPACE_DIR)) {
    rmSync(LEGACY_WORKSPACE_DIR, { recursive: true, force: true });
  }
  if (existsSync(BIN_DIR)) {
    rmSync(BIN_DIR, { recursive: true, force: true });
  }
}

// --- Main ---

async function main(): Promise<void> {
  console.log('prisma record');
  console.log('==================\n');

  validatePrerequisites();

  emitMp4 = process.argv.includes('--mp4');
  noCache = process.argv.includes('--no-cache');

  const parsedArgs = parseArgs();

  if (parsedArgs.mode === 'all-journeys') {
    return await mainAllJourneys();
  }

  if (parsedArgs.mode === 'journey') {
    return await mainJourney(parsedArgs.slug);
  }

  return await mainRecordings();
}

async function mainRecordings(): Promise<void> {
  const baseConnStr = process.env['DATABASE_URL'] ?? DEFAULT_DATABASE_URL;
  legacyConnectionString = baseConnStr;

  const groups = Object.keys(config.recordings);
  const allRecordings = Object.entries(config.recordings).flatMap(([group, recordings]) =>
    recordings.map((recording) => ({ group, recording })),
  );

  const needsDatabase = allRecordings.some(
    ({ recording }) => (recording.setup ?? 'none') !== 'none',
  );

  if (needsDatabase) {
    console.log('Loading test utils...');
    testUtils = await loadTestUtils();
    console.log(`Database: ${baseConnStr.replace(/\/\/.*@/, '//***@')}`);
  }

  try {
    for (const dir of [TAPES_DIR, SVGS_DIR, ASCII_DIR]) {
      for (const group of groups) {
        mkdirSync(join(dir, group), { recursive: true });
      }
    }

    const sharedTapePath = join(TAPES_DIR, 'shared-config.tape');
    writeFileSync(sharedTapePath, generateSharedTape());

    console.log(`\n${allRecordings.length} recordings across ${groups.length} groups`);

    const cache = noCache ? {} : readCache();
    let completed = 0;
    for (const { group, recording } of allRecordings) {
      await recordOne({ group, recording, sharedTapePath, cache });
      completed++;
      console.log(`  [${completed}/${allRecordings.length}]`);
    }
    if (!noCache) writeCache(cache);

    console.log('\n==================');
    console.log(`Done! ${allRecordings.length} recordings generated.`);
    console.log(`  SVGs:  ${relative(process.cwd(), SVGS_DIR)}/`);
    console.log(`  ASCII: ${relative(process.cwd(), ASCII_DIR)}/`);
    console.log(`  Tapes: ${relative(process.cwd(), TAPES_DIR)}/`);
  } finally {
    cleanupWorkspaces([]);
  }
}

async function mainJourney(slug: string): Promise<void> {
  const baseConnStr = process.env['DATABASE_URL'] ?? DEFAULT_DATABASE_URL;

  console.log('Loading test utils...');
  testUtils = await loadTestUtils();
  console.log(`Database: ${baseConnStr.replace(/\/\/.*@/, '//***@')}`);

  const workspaceDir = join(FIXTURE_APP_DIR, `.recording-workspace-${slug}`);

  try {
    mkdirSync(TAPES_DIR, { recursive: true });
    const sharedTapePath = join(TAPES_DIR, 'shared-config.tape');
    writeFileSync(sharedTapePath, generateSharedTape());

    await recordJourney({
      slug,
      journey: config.journeys[slug]!,
      connectionString: baseConnStr,
      workspaceDir,
      sharedTapePath,
    });

    console.log('\n==================');
    console.log(`Done! ${config.journeys[slug]!.steps.length} journey steps recorded.`);
    console.log(`  SVGs:  ${relative(process.cwd(), join(SVGS_DIR, slug))}/`);
    console.log(`  ASCII: ${relative(process.cwd(), join(ASCII_DIR, slug))}/`);
  } finally {
    cleanupWorkspaces([slug]);
  }
}

async function mainAllJourneys(): Promise<void> {
  const baseConnStr = process.env['DATABASE_URL'] ?? DEFAULT_DATABASE_URL;
  const slugs = Object.keys(config.journeys);
  const concurrency = Math.min(slugs.length, 4);

  console.log('Loading test utils...');
  testUtils = await loadTestUtils();
  console.log(`Database: ${baseConnStr.replace(/\/\/.*@/, '//***@')}`);

  const totalSteps = slugs.reduce((sum, s) => sum + config.journeys[s]!.steps.length, 0);
  console.log(`\n${slugs.length} journeys, ${totalSteps} total steps, concurrency: ${concurrency}`);

  // Create one database per journey for parallel recording
  console.log('Creating database pool...');
  const dbUrls = await createDatabasePool(baseConnStr, slugs.length);

  mkdirSync(TAPES_DIR, { recursive: true });
  const sharedTapePath = join(TAPES_DIR, 'shared-config.tape');
  writeFileSync(sharedTapePath, generateSharedTape());

  try {
    const tasks = slugs.map(
      (slug, i) => () =>
        recordJourney({
          slug,
          journey: config.journeys[slug]!,
          connectionString: dbUrls[i]!,
          workspaceDir: join(FIXTURE_APP_DIR, `.recording-workspace-${slug}`),
          sharedTapePath,
        }),
    );

    await runParallel(tasks, concurrency);

    console.log('\n==================');
    console.log(`Done! ${slugs.length} journeys, ${totalSteps} steps recorded.`);
    console.log(`  SVGs:  ${relative(process.cwd(), SVGS_DIR)}/`);
    console.log(`  ASCII: ${relative(process.cwd(), ASCII_DIR)}/`);
  } finally {
    cleanupWorkspaces(slugs);
    await destroyDatabasePool(baseConnStr, slugs.length).catch(() => {});
  }
}

main().catch((err) => {
  cleanupWorkspaces(Object.keys(config.journeys));
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
