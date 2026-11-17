import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ifDefined } from '@internal/utils/defined';
import { resolveTelemetryEndpoint } from './endpoint';
import { resolveGating } from './gating';
import type { ParentToSenderPayload } from './payload';
import { type CommanderResultShape, sanitizeCommanderResult } from './sanitize';
import { readUserConfig, type UserConfig } from './user-config';

/**
 * Inputs the CLI entry point hands the telemetry layer at command
 * start. The CLI is responsible for stitching commander's result and
 * the project root together; the telemetry module does no I/O of its
 * own except for the user-config read (skipped when `userConfig` is
 * provided). `extensions` is deliberately absent: the detached child
 * loads `prisma.config.*` via c12 itself and derives the
 * extension-pack ids from the validated config — see the rationale
 * on `ParentToSenderPayload` for why c12 lives in the child rather
 * than on the parent's hot path.
 *
 * `databaseTarget` is an optional parent-side override forwarded to
 * the child. Set by `fireTelemetryAfterInitConsent` (where the
 * config file does not yet exist on disk); left unset by the
 * preAction-hook path so the child's c12 load supplies the value.
 */
export interface RunTelemetryInputs {
  /** Sanitised commander snapshot — see `CommanderResultShape`. */
  readonly command: CommanderResultShape;
  /** This CLI's own version (from its `package.json`). */
  readonly version: string;
  /** Absolute path of the project root (typically `process.cwd()`). */
  readonly projectRoot: string;
  /**
   * Optional parent-side override for the c12-derived database target,
   * forwarded verbatim to the child sender. Wins over the child's
   * c12-derived value when present; `undefined` means "no override".
   */
  readonly databaseTarget?: string;
  /**
   * Exit code of the settled run, when the caller reports after settlement
   * (the engine bin's `onSettled` path). `undefined` when unknown.
   */
  readonly exitCode: number | undefined;
  /**
   * Path to the sender entry compiled into this package's `dist/`.
   * Resolved by the caller because the compiled sender lives at
   * `<package>/dist/sender.mjs` and only the consumer knows its own
   * `import.meta.url`.
   */
  readonly senderPath: string;
  /**
   * `isCI()` result from the consumer. Telemetry is suppressed when
   * `true` regardless of the stored consent answer — CI environments
   * never emit (matches the colour-output convention's CI suppression).
   */
  readonly isCI: boolean;
  /** Process env to read for opt-out signals. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Cached user config when the caller already read it to resolve gates before other work. */
  readonly userConfig?: UserConfig;
}

/**
 * Best-effort telemetry spawn at command start. Returns synchronously —
 * the fork runs in the background and never blocks the parent. Every
 * failure mode is swallowed; the parent's stdout/stderr is untouched in
 * normal operation, the only escape valve being
 * `PRISMA_DEBUG=1` which routes diagnostics to stderr.
 *
 * Returns the spawn outcome so debug-mode logging and the test-harness
 * probe (which verifies test runs short-circuit the fork) can inspect
 * the decision without scraping stderr.
 */
export type TelemetryRunOutcome =
  | { readonly spawned: true }
  | { readonly spawned: false; readonly reason: 'gated-off' | 'ci' | 'fork-failed' };

export function runTelemetry(inputs: RunTelemetryInputs): TelemetryRunOutcome {
  const env = inputs.env ?? process.env;

  if (inputs.isCI) {
    return { spawned: false, reason: 'ci' };
  }

  const config = inputs.userConfig ?? readUserConfig();
  const gating = resolveGating({ env, config });
  if (!gating.enabled) {
    return { spawned: false, reason: 'gated-off' };
  }

  const sanitised = sanitizeCommanderResult(inputs.command);
  // Gating resolved enabled, so installationId should be set: the parent
  // fire path mints it before calling runTelemetry on the default-on
  // first run, and the init consent flow mints it on explicit opt-in.
  // Defence-in-depth: a missing id here means a stale/corrupt config, so
  // skip rather than send a junk event.
  if (typeof config.installationId !== 'string' || config.installationId.length === 0) {
    return { spawned: false, reason: 'gated-off' };
  }

  const payload: ParentToSenderPayload = {
    installationId: config.installationId,
    version: inputs.version,
    command: sanitised.command,
    flags: sanitised.flags,
    projectRoot: inputs.projectRoot,
    endpoint: resolveTelemetryEndpoint(env),
    ...ifDefined('databaseTarget', inputs.databaseTarget),
    ...ifDefined('exitCode', inputs.exitCode),
  };

  try {
    const child = fork(inputs.senderPath, [], {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
    });
    child.send(payload, (err) => {
      if (err !== null && process.env['PRISMA_DEBUG'] === '1') {
        process.stderr.write(`[cli-telemetry] parent send error: ${String(err)}\n`);
      }
    });
    child.disconnect();
    child.unref();
    return { spawned: true };
  } catch (err) {
    if (process.env['PRISMA_DEBUG'] === '1') {
      process.stderr.write(`[cli-telemetry] parent fork failed: ${String(err)}\n`);
    }
    return { spawned: false, reason: 'fork-failed' };
  }
}

/**
 * Resolve the path to the compiled sender entry relative to a consumer
 * that has captured its own `import.meta.url`. The CLI's
 * `tsdown`-emitted entry sits at `<package>/dist/sender.mjs`; the
 * consumer asks `senderModuleUrl()` and forwards the result to
 * `runTelemetry({ senderPath })`.
 */
export function senderModuleUrl(importMetaUrl: string): string {
  return fileURLToPath(new URL('./sender.mjs', importMetaUrl));
}
