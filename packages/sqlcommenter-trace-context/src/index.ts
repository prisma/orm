import { getGlobalTracingHelper } from '@prisma/instrumentation-contract'
import type { SqlCommenterPlugin } from '@prisma/sqlcommenter'

/**
 * Parses the trace flags from a W3C Trace Context traceparent header.
 *
 * The traceparent format is: {version}-{trace-id}-{parent-id}-{trace-flags}
 * trace-flags is a 2-character hex value where bit 0 (0x01) indicates sampled.
 *
 * @see https://www.w3.org/TR/trace-context/#trace-flags
 */
function isSampled(traceparent: string): boolean {
  const parts = traceparent.split('-')
  if (parts.length !== 4) {
    return false
  }

  const traceFlags = parts[3]
  if (!traceFlags || traceFlags.length !== 2) {
    return false
  }

  const flags = parseInt(traceFlags, 16)
  if (isNaN(flags)) {
    return false
  }

  // Check if the sampled bit (0x01) is set
  return (flags & 0x01) === 0x01
}

/**
 * Creates a SQL commenter plugin that adds the W3C Trace Context `traceparent`
 * header to SQL queries when tracing is enabled and the current span is sampled.
 *
 * This plugin restores the traceparent comment functionality that was available
 * in Prisma prior to version 7, making it opt-in for users who want to correlate
 * SQL queries with distributed traces.
 *
 * The traceparent is only included when:
 * 1. Tracing is enabled via `@prisma/instrumentation`
 * 2. The current trace context has the sampled flag set
 *
 * @example
 * ```ts
 * import { traceContext } from '@prisma/sqlcommenter-trace-context'
 *
 * const prisma = new PrismaClient({
 *   adapter: myAdapter,
 *   comments: [traceContext()],
 * })
 * ```
 *
 * @see https://www.w3.org/TR/trace-context/
 */
export function traceContext(): SqlCommenterPlugin {
  return () => {
    const tracingHelper = getGlobalTracingHelper()

    // If tracing is not configured or not enabled, don't add traceparent
    if (!tracingHelper || !tracingHelper.isEnabled()) {
      return {}
    }

    const traceparent = tracingHelper.getTraceParent()

    // Only include traceparent if the current span is sampled
    if (!isSampled(traceparent)) {
      return {}
    }

    return { traceparent }
  }
}
