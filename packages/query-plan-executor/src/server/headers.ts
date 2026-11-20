import { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { Temporal } from 'temporal-polyfill'

import { parseDuration } from '../formats/duration'
import { parseSize } from '../formats/size'
import { ResourceLimits } from '../logic/resource-limits'
import { Options } from '../options'
import { extractErrorFromUnknown } from '../utils/error'

/**
 * Parses {@link ResourceLimits} from headers.
 *
 * Accelerate must make sure to filter these headers to prevent
 * malicious users from setting arbitrary resource limits. They
 * must only be set by Accelerate itself.
 */

export function parseResourceLimitsFromHeaders(ctx: Context): Partial<ResourceLimits> {
  return {
    queryTimeout: parseDurationFromHeaders(ctx, 'x-query-timeout'),
    maxTransactionTimeout: parseDurationFromHeaders(ctx, 'x-max-transaction-timeout'),
    maxResponseSize: parseSizeFromHeaders(ctx, 'x-max-response-size'),
  }
}

function parseDurationFromHeaders(ctx: Context, name: string): Temporal.Duration | undefined {
  const header = ctx.req.header(name)

  if (header === undefined) {
    return undefined
  }

  try {
    return parseDuration(header)
  } catch (error) {
    console.error('Failed to parse resource limit header', {
      name,
      error: extractErrorFromUnknown(error),
    })

    throw new HTTPException(400, { message: `Malformed ${name} header` })
  }
}

function parseSizeFromHeaders(ctx: Context, name: string): number | undefined {
  const header = ctx.req.header(name)

  if (header === undefined) {
    return undefined
  }

  try {
    return parseSize(header)
  } catch (error) {
    console.error('Failed to parse resource limit header', {
      name,
      error: extractErrorFromUnknown(error),
    })

    throw new HTTPException(400, { message: `Malformed ${name} header` })
  }
}

/**
 * Parses {@link ResourceLimits} from headers, using {@link Options}
 * to provide default values if they weren't overridden by Accelerate
 * using the headers.
 *
 * Accelerate must make sure to filter these headers to prevent
 * malicious users from setting arbitrary resource limits. They
 * must only be set by Accelerate itself.
 */
export function parseResourceLimitsFromHeadersWithDefaults(ctx: Context, options: Options): ResourceLimits {
  const limitsFromHeaders = parseResourceLimitsFromHeaders(ctx)
  return {
    queryTimeout: limitsFromHeaders.queryTimeout ?? options.queryTimeout,
    maxTransactionTimeout: limitsFromHeaders.maxTransactionTimeout ?? options.maxTransactionTimeout,
    maxResponseSize: limitsFromHeaders.maxResponseSize ?? options.maxResponseSize,
  }
}
