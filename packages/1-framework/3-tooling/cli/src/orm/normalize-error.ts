import { ifDefined } from '@internal/utils/defined';
import { isStructuredError } from '@internal/utils/structured-error';
import type { Diagnostic, NextAction } from '@prisma/cli-engine/protocol';
import { CliStructuredError } from '@prisma/cli-engine/protocol';

/**
 * The shape prisma/prisma's structured errors present to this module. Two kinds carry it: the
 * `CliStructuredError` class, and the plain values `structuredError()` builds, which have no
 * `toEnvelope` method. Reading them structurally keeps the conversion working across module
 * boundaries, where `instanceof` does not.
 */
interface RaisedError {
  readonly code: `${string}.${string}`;
  readonly message: string;
  readonly severity?: Diagnostic['severity'];
  readonly why?: string;
  readonly fix?: string;
  readonly where?: { readonly path?: string; readonly line?: number };
  readonly meta?: Record<string, unknown>;
  readonly docsUrl?: string;
  /**
   * Present only on the CLI package's own factories, which know the runnable
   * invocation that fixes the failure. Library-raised errors carry `fix` prose
   * and nothing else.
   */
  readonly nextActions?: readonly NextAction[];
  /** Findings reported alongside the error, already in the protocol's shape. */
  readonly diagnostics?: readonly Diagnostic[];
}

/**
 * `isStructuredError` is the repo's own check, and it is the one that matters here: it holds the
 * regular expression for a dotted `NAMESPACE.SUBCODE`, so only a code the protocol accepts
 * reaches `Diagnostic['code']`.
 */
function isRaisedError(error: unknown): error is Error & RaisedError {
  return error instanceof Error && isStructuredError(error);
}

/**
 * The fallback for anything that is not a structured error: a bare throw, and also an error whose
 * `code` is not a dotted one — a Node `ENOENT`, say. The rejected code survives in `meta` rather
 * than in `code`, where it would produce a docs link to a page that does not exist.
 */
function toUnexpected(error: unknown): CliStructuredError {
  const summary = error instanceof Error ? error.message : String(error);
  const rejectedCode = error instanceof Error ? Reflect.get(error, 'code') : undefined;
  return new CliStructuredError('CLI.UNEXPECTED', summary, {
    ...ifDefined('meta', typeof rejectedCode === 'string' ? { code: rejectedCode } : undefined),
    cause: error,
  });
}

/**
 * Both classes name themselves `CliStructuredError`, so the engine's duck test
 * accepts prisma/prisma's too, and a CLI factory carrying typed actions looks
 * conformant without being one — its `toEnvelope` still writes `fix` and no
 * `nextActions`. Only an error the engine itself built is already in protocol
 * shape, and `@prisma/cli-engine` is an exact-pinned, unbundled dependency, so
 * there is one module instance and identity holds.
 */
function conformsToProtocol(error: unknown): error is CliStructuredError {
  return error instanceof CliStructuredError;
}

/**
 * Turns the transitional `fix` prose into typed actions. A multi-line fix is
 * several pieces of advice, so it becomes one action per line.
 */
function actionsFromFix(fix: string | undefined): readonly NextAction[] {
  if (fix === undefined) {
    return [];
  }
  return fix
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((label) => ({ kind: 'user-choice', label }) satisfies NextAction);
}

/**
 * Projects a prisma/prisma-raised error onto the engine's diagnostic shape.
 */
export function toEngineDiagnostic(error: Error & RaisedError): Diagnostic {
  return {
    code: error.code,
    severity: error.severity ?? 'error',
    summary: error.message,
    ...ifDefined('why', error.why),
    nextActions: error.nextActions ?? actionsFromFix(error.fix),
    ...ifDefined('where', error.where),
    ...ifDefined('meta', error.meta),
    ...ifDefined('docsUrl', error.docsUrl),
  };
}

/**
 * The handler boundary's single conversion. Handlers pass every error they
 * return through `notOk` — and every error a top-of-handler catch sees —
 * through this, so a settled envelope always carries `nextActions` and never
 * the non-protocol `fix` field.
 */
export function normalizeError(error: unknown): CliStructuredError {
  if (conformsToProtocol(error)) {
    return error;
  }
  if (!isRaisedError(error)) {
    return toUnexpected(error);
  }

  const diagnostic = toEngineDiagnostic(error);
  return new CliStructuredError(diagnostic.code, diagnostic.summary, {
    severity: diagnostic.severity,
    nextActions: diagnostic.nextActions,
    ...ifDefined('diagnostics', error.diagnostics),
    ...ifDefined('why', diagnostic.why),
    ...ifDefined('where', diagnostic.where),
    ...ifDefined('meta', diagnostic.meta),
    ...ifDefined('docsUrl', diagnostic.docsUrl),
    cause: error,
  });
}
