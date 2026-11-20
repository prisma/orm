import util from 'node:util'

import { zValidator } from '@hono/zod-validator'
import { QueryPlanNode, TransactionManagerError, UserFacingError } from '@prisma/client-engine-runtime'
import { Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'

import * as log from '../log/facade'
import { App } from '../logic/app'
import { ResourceLimitError, ResourceLimits } from '../logic/resource-limits'
import { Options } from '../options'
import { clientTelemetryMiddleware } from './middleware/client-telemetry'
import { fallbackLoggerMiddleware } from './middleware/fallback-logger'
import { logMiddleware } from './middleware/log'
import { resourceLimitsMiddleware } from './middleware/resource-limits'
import {
  ConnectionInfoResponseBody,
  QueryRequestBody,
  QueryResponseBody,
  TransactionEndResponseBody,
  TransactionStartRequestBody,
  TransactionStartResponseBody,
} from './schemas'

/**
 * A query plan executor server compatible with `@hono/node-server`, `Deno.serve` etc.
 */
export class Server {
  readonly #app: App
  readonly #hono: HonoServer

  private constructor(app: App, hono: HonoServer) {
    this.#app = app
    this.#hono = hono
  }

  static async create(options: Options): Promise<Server> {
    const app = await App.start(options)
    const server = createHonoServer(app, options)
    return new Server(app, server)
  }

  get fetch(): HonoServer['fetch'] {
    return this.#hono.fetch
  }

  async shutdown(): Promise<void> {
    await this.#app.shutdown()
  }
}

type HonoServer = ReturnType<typeof createHonoServer>

function createHonoServer(app: App, options: Options) {
  type Env = {
    Variables: {
      requestId: string
      resourceLimits: ResourceLimits
    }
  }

  const server = new Hono<Env>()

  return server
    .onError((error, c) => {
      log.error('Error processing request', {
        error: util.inspect(error),
        method: c.req.method,
        pathname: c.req.path,
        requestId: c.get('requestId'),
      })
      return getErrorResponse(error, c)
    })
    .use(fallbackLoggerMiddleware(options.perRequestLogContext))
    .use(logMiddleware)
    .use(clientTelemetryMiddleware)
    .use(resourceLimitsMiddleware(options))
    .get('/health', (c) => {
      return c.json({ status: 'ok' })
    })
    .get('/connection-info', (c) => {
      return c.json(app.getConnectionInfo() satisfies ConnectionInfoResponseBody)
    })
    .post('/query', zValidator('json', QueryRequestBody), async (c) => {
      const request = c.req.valid('json')
      const data = await app.query(
        request.plan as QueryPlanNode,
        request.params,
        request.comments,
        c.get('resourceLimits'),
        null,
      )
      return c.json({ data } satisfies QueryResponseBody)
    })
    .post('/transaction/start', zValidator('json', TransactionStartRequestBody), async (c) => {
      const result = await app.startTransaction(c.req.valid('json'), c.get('resourceLimits'))
      c.header('Prisma-Transaction-Id', result.id)
      return c.json(result satisfies TransactionStartResponseBody)
    })
    .post('/transaction/:txId/query', zValidator('json', QueryRequestBody), async (c) => {
      const request = c.req.valid('json')
      const data = await app.query(
        request.plan as QueryPlanNode,
        request.params,
        request.comments,
        c.get('resourceLimits'),
        c.req.param('txId'),
      )
      return c.json({ data } satisfies QueryResponseBody)
    })
    .post('/transaction/:txId/commit', async (c) => {
      await app.commitTransaction(c.req.param('txId'))
      return c.json({} satisfies TransactionEndResponseBody)
    })
    .post('/transaction/:txId/rollback', async (c) => {
      await app.rollbackTransaction(c.req.param('txId'))
      return c.json({} satisfies TransactionEndResponseBody)
    })
}

function getErrorResponse(error: Error, ctx: Context): Response {
  if (error instanceof HTTPException) {
    return error.getResponse()
  } else if (error instanceof ResourceLimitError) {
    return ctx.json({ error: error.message } satisfies QueryResponseBody, 422)
  } else if (error instanceof TransactionManagerError) {
    return ctx.json(
      {
        code: error.code,
        error: error.message,
        meta: error.meta,
      } satisfies QueryResponseBody,
      409,
    )
  } else if (error instanceof UserFacingError) {
    return ctx.json(
      {
        code: error.code,
        error: error.message,
        meta: error.meta,
      } satisfies QueryResponseBody,
      400,
    )
  } else {
    return ctx.json({ error: error.message }, 500)
  }
}
