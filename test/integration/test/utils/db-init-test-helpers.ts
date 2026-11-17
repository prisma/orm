import { loadOrmConfig, ormCommandFamily } from '@internal/cli';
import { ifDefined } from '@internal/utils/defined';
import type { StreamEvent } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import type { setupTestDirectoryFromFixtures } from './cli-test-helpers';
import { ormEngineMount, setupDbTestFixture } from './cli-test-helpers';

export type DbInitTestSetup = ReturnType<typeof setupTestDirectoryFromFixtures>;

export async function setupDbInitFixture(
  connectionString: string,
  createTempDir: () => string,
  fixtureSubdir: string,
  schemaSql?: string,
): Promise<{ testSetup: DbInitTestSetup; configPath: string }> {
  return setupDbTestFixture({
    connectionString,
    createTempDir,
    fixtureSubdir,
    ...ifDefined('schemaSql', schemaSql),
  });
}

/** What one `db init` run reported. */
export interface DbInitRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Parsed stream (events plus the terminal result) in json mode. */
  readonly json: readonly StreamEvent[];
  /**
   * The command's own document: the envelope's `result` when it completed and
   * its `error` when it did not. Undefined for a run that never settled a
   * command, and in human mode, where no frame is written.
   */
  readonly document: unknown;
}

function terminalDocument(json: readonly StreamEvent[]): unknown {
  const terminal = json.at(-1);
  if (terminal === undefined || terminal.kind !== 'result') {
    return undefined;
  }
  return terminal.envelope.ok ? terminal.envelope.result : terminal.envelope.error;
}

/**
 * Runs `db init` through the engine. The step's directory is passed as `cwd`
 * rather than chdir'ed into, so nothing about the run is process-global — which
 * also means its output is on the returned streams rather than in whatever the
 * caller has mocked the console with.
 */
export async function runDbInit(
  testSetup: DbInitTestSetup,
  args: readonly string[],
): Promise<DbInitRun> {
  const mount = ormEngineMount();
  const cli = createTestCli({
    commandFamilies: [ormCommandFamily],
    commands: mount.commands,
    groups: mount.groups,
    // The engine parses `--config` itself and hands the path to this loader,
    // exactly as the real runtime does.
    loadConfig: (configPath) =>
      loadOrmConfig({ cwd: testSetup.testDir, ...ifDefined('configPath', configPath) }),
  });
  // Both streams are one terminal, as in the journey harness, so stdout carries
  // no data lines. A step that wants the JSON frames passes --json.
  const run = await cli.run(['db', 'init', ...args], {
    cwd: testSetup.testDir,
    isTty: { stdout: true, stderr: true },
  });
  return {
    exitCode: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    json: run.json,
    document: terminalDocument(run.json),
  };
}

/**
 * The engine settles every failure into an exit code rather than throwing, so
 * this is the same call. It survives as its own name because the call sites say
 * which of the two they mean.
 */
export const runDbInitAllowFailure = runDbInit;
