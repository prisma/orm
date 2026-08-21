import { docsUrlFor } from '@internal/utils/structured-error';
import type { CliStructuredError, Diagnostic, NextAction } from '@prisma/cli-engine/protocol';
import { chooseAction, runCommandAction } from '../utils/next-actions';

/** The invocation that finishes what a failed `init` phase started. */
export const EMIT_COMMAND = 'prisma-cli contract emit';

/**
 * The command's own record of a phase that failed after the scaffold was
 * written. The scaffold is on disk and the run has a result to report, so each
 * of these rides a completed envelope as a finding rather than replacing it.
 */
function initFinding(
  code: `${string}.${string}`,
  summary: string,
  parts: {
    readonly why: string;
    readonly nextActions: readonly NextAction[];
    readonly meta: Record<string, unknown>;
  },
): Diagnostic {
  return {
    code,
    severity: 'error',
    summary,
    why: parts.why,
    nextActions: parts.nextActions,
    meta: parts.meta,
    docsUrl: docsUrlFor(code),
  };
}

/**
 * The dependency install failed. The engine composed and announced the command
 * line, so its own next action — which carries the redacted spelling — is the
 * one that tells the user what to run; `init` adds the emit that was waiting
 * on it.
 */
export function installFailedFinding(
  failure: CliStructuredError,
  filesWritten: readonly string[],
): Diagnostic {
  return initFinding('CLI.INIT_INSTALL_FAILED', 'Failed to install dependencies', {
    why: failure.why ?? failure.message,
    nextActions: [
      ...failure.nextActions,
      runCommandAction('Emit the contract once the dependencies are installed', EMIT_COMMAND),
    ],
    meta: { filesWritten, install: failure.meta ?? {} },
  });
}

/** The first emit failed against the freshly written scaffold. */
export function emitFailedFinding(cause: string, filesWritten: readonly string[]): Diagnostic {
  return initFinding('CLI.INIT_EMIT_FAILED', 'Failed to emit contract', {
    why: `\`${EMIT_COMMAND}\` failed: ${cause}`,
    nextActions: [
      chooseAction('Fix the problem the contract source reports, then emit again'),
      runCommandAction('Emit the contract', EMIT_COMMAND),
    ],
    meta: { filesWritten, cause },
  });
}
