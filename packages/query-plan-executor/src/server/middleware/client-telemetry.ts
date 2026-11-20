import { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'

import { getActiveLogger, withActiveLogger } from '../../log/context'
import { ExportableLogEvent } from '../../log/event'
import * as log from '../../log/facade'
import { discreteLogFilter } from '../../log/filter'
import { LogLevel, parseLogLevel } from '../../log/log-level'
import { Logger } from '../../log/logger'
import { CapturingSink, CompositeSink, FilteringSink } from '../../log/sink'
import { TracingCollector, tracingCollectorContext } from '../../tracing/collector'
import { ExportableSpan } from '../../tracing/span'
import { extractErrorFromUnknown } from '../../utils/error'

interface ResultExtensions {
  logs?: ExportableLogEvent[]
  spans?: ExportableSpan[]
}

/**
 * Middleware that handles the `X-Capture-Telemetry` header,
 * captures telemetry data based on the header settings and
 * injects the `logs` and `spans` properties to the response.
 */
export const clientTelemetryMiddleware = createMiddleware<{
  Variables: { requestId: string }
}>(async (ctx, next) => {
  const captureTelemetryHeader = ctx.req.header('x-capture-telemetry')

  if (captureTelemetryHeader === undefined) {
    await next()
    return
  }

  const captureSettings = parseClientTelemetryHeaderOrThrowBadRequest(captureTelemetryHeader)

  const spanCollector = TracingCollector.newInCurrentContext()
  const logCollector = new CapturingSink()

  const logger = new Logger(
    new CompositeSink(
      getActiveLogger().sink,
      new FilteringSink(logCollector, discreteLogFilter(captureSettings.logLevels)),
    ),
  )

  await tracingCollectorContext.withActive(spanCollector, async () => {
    await withActiveLogger(logger, next)
  })

  const jsonResponse = await tryGetJsonResponse(ctx)

  if (jsonResponse === undefined) {
    return
  }

  const extensions: ResultExtensions = {}

  if (captureSettings.logLevels.length > 0) {
    extensions.logs = logCollector.export()
  }

  if (captureSettings.spans) {
    extensions.spans = spanCollector.spans
  }

  jsonResponse.extensions = extensions

  const { status, headers } = ctx.res

  // `res` needs to be set to `undefined` first to replace it
  // https://hono.dev/docs/guides/middleware#modify-the-response-after-next
  // https://github.com/honojs/hono/pull/970
  ctx.res = undefined
  ctx.res = new Response(JSON.stringify(jsonResponse), { status, headers })
})

export type CaptureSettings = {
  spans: boolean
  logLevels: LogLevel[]
}

export function parseClientTelemetryHeader(header: string): CaptureSettings {
  const result: CaptureSettings = {
    spans: false,
    logLevels: [],
  }

  for (const level of header.split(',')) {
    const trimmedLevel = level.trim()

    if (trimmedLevel === '') continue

    if (trimmedLevel === 'tracing') {
      result.spans = true
      continue
    }

    result.logLevels.push(parseLogLevel(trimmedLevel))
  }

  return result
}

function parseClientTelemetryHeaderOrThrowBadRequest(header: string): CaptureSettings {
  try {
    return parseClientTelemetryHeader(header)
  } catch (error) {
    log.error('Failed to parse client telemetry header', {
      error: extractErrorFromUnknown(error),
    })
    throw new HTTPException(400, { message: 'Malformed X-Capture-Telemetry header' })
  }
}

async function tryGetJsonResponse(
  c: Context<{ Variables: { requestId: string } }>,
): Promise<Record<PropertyKey, unknown> | undefined> {
  const contentType = c.res.headers.get('content-type')

  if (contentType?.includes('application/json')) {
    return await c.res.json()
  }

  log.error("Telemetry can't be injected into non-JSON response", {
    method: c.req.method,
    pathname: c.req.path,
    requestId: c.get('requestId'),
  })

  return undefined
}
