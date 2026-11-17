/**
 * A bug in Prisma 8, not a user error. Never catch this except at the
 * outermost boundary for crash reporting — an InternalError means an invariant
 * broke and the process cannot reliably continue. User-facing failures use
 * `structuredError` with a dotted code instead.
 */
export class InternalError extends Error {
  readonly isPrismaInternalError = true;

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'InternalError';
  }
}

export function isInternalError(e: unknown): e is InternalError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'isPrismaInternalError' in e &&
    e.isPrismaInternalError === true
  );
}

export function assertNever(value: never, message?: string): never {
  throw new InternalError(message ?? `Unreachable: unexpected value ${String(value)}`);
}
