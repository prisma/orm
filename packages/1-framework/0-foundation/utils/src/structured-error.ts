import { ifDefined } from './defined';

/**
 * One machine-readable remediation step, replacing freeform `fix` prose. See
 * [ADR 239](../../../../../docs/architecture%20docs/adrs/ADR%20239%20-%20Errors%20are%20structural%20envelopes%20with%20dotted%20namespace%20codes.md#remediation-is-typed-not-prose).
 *
 * `kind` says what the consumer must do: `run-command` (`command` for a single
 * command, `commands` for an ordered sequence — never both), `open-url` (visit
 * `url`), `user-choice` (a human must decide), `edit-file` (a file needs a
 * human edit), `done` (nothing further is required).
 *
 * A `command` never hardcodes a binary name. Write `{bin}` where the binary
 * goes — `{bin} migration ref set <name> <hash>` — and the surface that renders the
 * action substitutes the name of the binary the user actually ran. Angle
 * brackets mark a value only the user can supply; everything outside them is
 * literal and runnable.
 */
export interface NextAction {
  readonly kind: 'run-command' | 'open-url' | 'user-choice' | 'edit-file' | 'done';
  readonly label: string;
  readonly command?: string;
  readonly commands?: readonly string[];
  readonly url?: string;
  readonly reason?: string;
}

export interface StructuredError extends Error {
  readonly code: `${string}.${string}`;
  readonly why?: string;
  readonly fix?: string;
  readonly nextActions?: readonly NextAction[];
  readonly where?: { readonly path?: string; readonly line?: number };
  readonly severity?: 'error' | 'warn' | 'info';
  readonly meta?: Record<string, unknown>;
  readonly docsUrl?: string;
}

export interface StructuredErrorOptions {
  readonly why?: string;
  readonly fix?: string;
  readonly nextActions?: readonly NextAction[];
  readonly where?: { readonly path?: string; readonly line?: number };
  readonly severity?: 'error' | 'warn' | 'info';
  readonly meta?: Record<string, unknown>;
  readonly docsUrl?: string;
  readonly cause?: unknown;
}

const STRUCTURED_CODE_RE = /^[A-Z][A-Z0-9]*\.[A-Z][A-Z0-9_]*$/;

/** Whether a bare string is a published `NAMESPACE.SUBCODE` code. */
export function isStructuredErrorCode(code: string): code is StructuredError['code'] {
  return STRUCTURED_CODE_RE.test(code);
}

export function isStructuredError(e: unknown): e is StructuredError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    typeof e.code === 'string' &&
    isStructuredErrorCode(e.code) &&
    'message' in e &&
    typeof e.message === 'string'
  );
}

export function structuredError(
  code: StructuredError['code'],
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  const error =
    options?.cause !== undefined
      ? new Error(message, { cause: options.cause })
      : new Error(message);
  Object.defineProperty(error, 'name', { value: 'StructuredError', configurable: true });
  return Object.assign(error, {
    code,
    ...ifDefined('why', options?.why),
    ...ifDefined('fix', options?.fix),
    ...ifDefined('nextActions', options?.nextActions),
    ...ifDefined('where', options?.where),
    ...ifDefined('severity', options?.severity),
    ...ifDefined('meta', options?.meta),
    ...ifDefined('docsUrl', options?.docsUrl),
  });
}

export const DOCS_ERRORS_VERSION = 'next';
export const DOCS_BASE = `https://docs.prisma.io/docs/orm/${DOCS_ERRORS_VERSION}/reference/error-reference`;

export function docsUrlFor(code: string): string {
  return `${DOCS_BASE}#${code}`;
}
