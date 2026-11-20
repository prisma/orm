import { serve } from '@hono/node-server'
import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'

import * as Qpe from '../src'

context.setGlobalContextManager(new AsyncLocalStorageContextManager())
trace.setGlobalTracerProvider(new BasicTracerProvider())

void (async () => {
  const databaseUrl = process.env.TEST_POSTGRES_URI
  if (!databaseUrl) {
    throw new Error('TEST_POSTGRES_URI is not set')
  }

  await Qpe.withActiveLogger(Qpe.createConsoleLogger('text', 'debug'), async () => {
    const server = await Qpe.Server.create({
      databaseUrl,
      maxResponseSize: Qpe.parseSize('128 MiB'),
      queryTimeout: Qpe.parseDuration('PT5M'),
      maxTransactionTimeout: Qpe.parseDuration('PT5M'),
      maxTransactionWaitTime: Qpe.parseDuration('PT5M'),
    })

    const port = 8000

    serve({ fetch: server.fetch, port }, () => {
      Qpe.log.info('Server listening', { port })
    })
  })
})()
