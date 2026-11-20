import { createMiddleware } from 'hono/factory'

import { withActiveLogger } from '../../log/context'
import { createConsoleLogger } from '../../log/factory'
import { LogOptions } from '../../options'

export const fallbackLoggerMiddleware = (options: LogOptions | undefined) =>
  createMiddleware(async (_, next) => {
    if (options) {
      await withActiveLogger(createConsoleLogger(options.logFormat, options.logLevel), next)
    } else {
      await next()
    }
  })
