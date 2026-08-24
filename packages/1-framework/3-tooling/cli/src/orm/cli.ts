import { fstatSync } from 'node:fs';
import { ifDefined } from '@internal/utils/defined';
import type { Cli, HostProcess, MountedTree, Runtime } from '@prisma/cli-engine';
import { createCli, telemetryCommandGroup } from '@prisma/cli-engine';
import { version as CLI_VERSION } from '../../package.json' with { type: 'json' };
import { createControlClient } from '../control-api/client';
import type { CreateControlClient } from '../control-api/types';
import { contractEmitCommand } from './contract/emit';
import { contractInferCommand } from './contract/infer';
import { createDbInitCommand } from './db/init';
import { createDbSchemaCommand } from './db/schema';
import { createDbSignCommand } from './db/sign';
import { createDbUpdateCommand } from './db/update';
import { createDbVerifyCommand } from './db/verify';
import { ormCommandFamily } from './family';
import { formatCommand } from './format';
import { initCommand } from './init';
import { loadOrmConfig } from './load-config';
import { lspCommand } from './lsp';
import { createMigrateCommand } from './migrate';
import { migrationCheckCommand } from './migration/check';
import { migrationGraphCommand } from './migration/graph';
import { migrationListCommand } from './migration/list';
import { migrationLogCommand } from './migration/log';
import { migrationNewCommand } from './migration/new';
import { migrationPlanCommand } from './migration/plan';
import { migrationShowCommand } from './migration/show';
import { migrationStatusCommand } from './migration/status';
import { normalizeError } from './normalize-error';
import { runPackageManager } from './package-manager-runner';
import { refDeleteCommand } from './ref/delete';
import { refListCommand } from './ref/list';
import { refSetCommand } from './ref/set';
import { resolveTelemetryHooks } from './telemetry/reporting';

/**
 * This repo's stand-in for the unified Prisma CLI: it mounts the ORM command
 * family exactly the way the real host does — every command at its family
 * key, which spells the unified CLI's mount path (`contract format`,
 * `db migrate`, `migration ref …`, `orm init`) — same command paths, same
 * `prisma.config.ts`, so examples and e2e tests exercise the commands as
 * users run them. The real host lives in the prisma-cli repo and consumes
 * {@link ormCommandFamily} from this package's exports.
 */
export const BIN_NAME = 'prisma';

export const TELEMETRY_DOCS_URL = 'https://prisma-next.dev/docs/cli/telemetry';

/**
 * The engine's consent surface — `telemetry status|enable|disable` and the
 * group help that belongs to them. Mounted whole, mirroring the unified
 * `prisma` bin's mount points.
 */
const telemetry = telemetryCommandGroup({ docsUrl: TELEMETRY_DOCS_URL });

export const BIN_GROUPS = {
  orm: {
    brief: 'Initialize a Prisma ORM project',
    description:
      'Project initialization for the ORM. The other ORM commands mount under\n' +
      'their workflow groups (contract, db, migration); only init lives here.',
  },
  contract: {
    brief: 'Contract management commands',
    description:
      'Define and emit your application data contract. The contract describes your\n' +
      'schema as a declarative data structure that can be signed and verified\n' +
      'against your database.',
  },
  db: {
    brief: 'Live database commands',
    description:
      'Inspect, bootstrap, verify and sign the live database against the\n' +
      'emitted contract. Every command in this group needs a database connection.',
  },
  migration: {
    brief: 'On-disk migration management commands',
    description:
      'Plan, apply, and scaffold on-disk migration packages. Migrations are\n' +
      'contract-to-contract edges stored as versioned directories under migrations/.',
  },
  'migration ref': {
    brief: 'Named pointers at contracts',
    description:
      'Manage the named refs under migrations/app/refs/. A ref maps a logical\n' +
      'environment name — staging, production — to a contract hash, so a command\n' +
      'can name the environment instead of the hash.',
  },
  ...telemetry.groups,
} as const;

/**
 * The command tree with its client factory injected, so tests can mount the
 * same tree over a control-client double instead of mocking modules.
 */
export function createBinCommands(createClient: CreateControlClient): MountedTree {
  return {
    'contract emit': contractEmitCommand,
    'contract format': formatCommand,
    'contract infer': contractInferCommand,
    'db init': createDbInitCommand(createClient),
    'db migrate': createMigrateCommand(createClient),
    'db schema': createDbSchemaCommand(createClient),
    'db sign': createDbSignCommand(createClient),
    'db update': createDbUpdateCommand(createClient),
    'db verify': createDbVerifyCommand(createClient),
    lsp: lspCommand,
    'migration check': migrationCheckCommand,
    'migration graph': migrationGraphCommand,
    'migration list': migrationListCommand,
    'migration log': migrationLogCommand,
    'migration new': migrationNewCommand,
    'migration plan': migrationPlanCommand,
    'migration ref delete': refDeleteCommand,
    'migration ref list': refListCommand,
    'migration ref set': refSetCommand,
    'migration show': migrationShowCommand,
    'migration status': migrationStatusCommand,
    'orm init': initCommand,
    ...telemetry.commands,
  };
}

export const BIN_COMMANDS: MountedTree = createBinCommands(createControlClient);

export function createOrmCli(): Cli {
  return createCli({
    name: BIN_NAME,
    version: CLI_VERSION,
    commandFamilies: [ormCommandFamily],
    groups: BIN_GROUPS,
    commands: BIN_COMMANDS,
  });
}

/**
 * The file identity behind a stream's fd, or undefined where the host exposes
 * no fd (a harness stream) or the fd cannot be stat-ed.
 */
function streamFileIdentity(
  stream: HostProcess['stdout'] | HostProcess['stderr'],
): string | undefined {
  if (!('fd' in stream) || typeof stream.fd !== 'number') {
    return undefined;
  }
  try {
    const stat = fstatSync(stream.fd);
    return `${stat.dev}:${stat.ino}`;
  } catch {
    return undefined;
  }
}

/**
 * Everything environmental the engine is given, adapted from the host process
 * once. The engine owns signal policy; the bin is dumb wiring.
 */
export function runtimeFromProcess(proc: HostProcess): Runtime {
  const stdoutFile = streamFileIdentity(proc.stdout);
  const stderrFile = streamFileIdentity(proc.stderr);
  const outputStreamsShareDevice =
    stdoutFile !== undefined && stderrFile !== undefined ? stdoutFile === stderrFile : undefined;
  return {
    stdout: { write: (text) => void proc.stdout.write(text) },
    // The terminal width the drawings get to use, read once with everything
    // else the runtime carries.
    stderr: {
      write: (text) => void proc.stderr.write(text),
      // biome-ignore lint/plugin/no-family-vocabulary: the terminal's width in characters, not storage
      ...ifDefined('columns', proc.stderr.columns),
    },
    stdin: proc.stdin,
    cwd: proc.cwd(),
    env: proc.env,
    isTty: {
      stdin: proc.stdin.isTTY === true,
      stdout: proc.stdout.isTTY === true,
      stderr: proc.stderr.isTTY === true,
    },
    ...ifDefined('outputStreamsShareDevice', outputStreamsShareDevice),
    host: {
      runtime: { name: 'node', version: proc.version },
      platform: proc.platform,
      arch: proc.arch,
    },
    exit: (code) => proc.exit(code),
    onSignal: (callback) => {
      const onInterrupt = () => callback('SIGINT');
      const onTerminate = () => callback('SIGTERM');
      proc.on('SIGINT', onInterrupt);
      proc.on('SIGTERM', onTerminate);
      return () => {
        proc.off('SIGINT', onInterrupt);
        proc.off('SIGTERM', onTerminate);
      };
    },
    loadConfig: (configPath) =>
      loadOrmConfig({ cwd: proc.cwd(), ...ifDefined('configPath', configPath) }),
    managementApi: { baseUrl: 'https://api.prisma.io' },
    // No `packageManager`: a host's answer overrides the engine's detection
    // outright, and this bin knows nothing the engine's own walk from cwd —
    // lockfile, then the manager that invoked this process — does not.
    runPackageManager,
  };
}

/** What the engine itself exits with for a failure it cannot attribute to a command. */
const STARTUP_FAILURE_EXIT_CODE = 1;

/**
 * The engine settles everything that happens inside a run. What happens before one exists —
 * reading the config, resolving telemetry, building the CLI — has no invocation to attach a
 * diagnostic to, so a throw there would reach the user as a raw stack trace. This writes the
 * same single line the engine writes in that position instead.
 */
function reportStartupFailure(proc: HostProcess, error: unknown): number {
  const normalized = normalizeError(error);
  proc.stderr.write(`✘ [${normalized.code}] ${normalized.message}\n`);
  return STARTUP_FAILURE_EXIT_CODE;
}

/** Parses, executes and settles one invocation; returns the exit code. */
export async function runOrmCli(proc: HostProcess): Promise<number> {
  try {
    const hooks = resolveTelemetryHooks(proc);
    return await createOrmCli().run(proc.argv.slice(2), runtimeFromProcess(proc), hooks);
  } catch (error) {
    return reportStartupFailure(proc, error);
  }
}
