import { createMiddleware } from 'hono/factory'

import * as log from '../../log/facade'

export const logMiddleware = createMiddleware<{
  Variables: {
    requestId: string
  }
}>(async (c, next) => {
  const id = crypto.randomUUID()

  c.set('requestId', id)

  log.debug('Request', {
    id,
    method: c.req.method,
    pathname: c.req.path,
  })

  await next()

  log.debug('Response', {
    id,
    status: c.res.status,
    method: c.req.method,
    pathname: c.req.path,
  })
})
