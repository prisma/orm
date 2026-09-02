import { fileURLToPath } from 'node:url';
import {
  type CommanderResultShape,
  ensureInstallationId,
  type RunTelemetryInputs,
  readUserConfig,
  resolveGating,
  runTelemetry,
  type TelemetryRunOutcome,
  type UserConfig,
  userConfigPath,
} from '@internal/cli-telemetry';
import type {
  CliRunHooks,
  EngineCommandSnapshot,
  HostProcess,
  RunSummary,
} from '@prisma/cli-engine';
import { version as CLI_VERSION } from '../../../package.json' with { type: 'json' };
import { isCI } from '../../utils/is-ci';

function senderPath(): string {
  return fileURLToPath(new URL(import.meta.resolve('@internal/cli-telemetry/sender')));
}

function firstRunNotice(configPath: string): string {
  return [
    'Prisma ORM collects anonymous CLI usage data, enabled by default.',
    "What's collected and why: https://prisma-next.dev/docs/cli/telemetry.",
    'Opt out: run "prisma telemetry disable", set DO_NOT_TRACK=1 or',
    `PRISMA_NEXT_DISABLE_TELEMETRY=1, or set "enableTelemetry": false in ${configPath}.`,
  ].join(' ');
}

/**
 * The engine's value-free snapshot, in the shape the existing sanitiser reads.
 * It drops the leading segment, so the binary name goes back on the front;
 * positional values are never reported, and the field exists only to make that
 * exclusion legible.
 */
function senderCommandShape(snapshot: EngineCommandSnapshot): CommanderResultShape {
  return {
    commandPath: ['prisma-next', ...snapshot.commandPath],
    positionalArgs: [],
    options: snapshot.flags.map((entry) => ({
      attributeName: entry.name,
      longName: `--${entry.name}`,
      source: entry.source,
    })),
  };
}

export interface TelemetryReportingOptions {
  /** CI decision override; defaults to `isCI()`. */
  readonly inCI?: boolean;
  /** Spawn seam for tests; defaults to `runTelemetry`. */
  readonly fire?: (inputs: RunTelemetryInputs) => TelemetryRunOutcome;
  readonly senderPath?: string;
}

/**
 * Resolves the telemetry decision once per process and returns the hook to
 * attach, or nothing at all when telemetry is off — a disabled run carries no
 * hook. The first-run disclosure prints here, before the command runs, so the
 * user learns what telemetry records before any output.
 *
 * The event fires from `onSettled`, after settlement, so it carries the exit
 * code. A run killed before settlement, and a run that never reaches a mounted
 * command, emit nothing.
 */
export function resolveTelemetryHooks(
  proc: Pick<HostProcess, 'env' | 'cwd' | 'stderr'>,
  options?: TelemetryReportingOptions,
): CliRunHooks | undefined {
  const inCI = options?.inCI ?? isCI();
  if (inCI) {
    return undefined;
  }
  const userConfig = readUserConfig();
  if (!resolveGating({ env: proc.env, config: userConfig }).enabled) {
    return undefined;
  }

  const storedId = userConfig.installationId;
  const hasStoredId = typeof storedId === 'string' && storedId.length > 0;
  if (!hasStoredId) {
    try {
      proc.stderr.write(`${firstRunNotice(userConfigPath())}\n`);
    } catch {}
  }

  const fire = options?.fire ?? runTelemetry;
  return {
    onSettled: (summary: RunSummary) => {
      try {
        let config: UserConfig = userConfig;
        if (!hasStoredId) {
          try {
            config = { ...config, installationId: ensureInstallationId() };
          } catch {}
        }
        fire({
          command: senderCommandShape(summary.snapshot),
          version: CLI_VERSION,
          exitCode: summary.exitCode,
          projectRoot: proc.cwd(),
          senderPath: options?.senderPath ?? senderPath(),
          isCI: inCI,
          env: proc.env,
          userConfig: config,
        });
      } catch {}
    },
  };
}
