import { createMiddleware } from 'hono/factory'

import { ResourceLimits } from '../../logic/resource-limits'
import { Options } from '../../options'
import { parseResourceLimitsFromHeadersWithDefaults } from '../headers'

export const resourceLimitsMiddleware = (options: Options) =>
  createMiddleware<{
    Variables: {
      resourceLimits: ResourceLimits
    }
  }>(async (c, next) => {
    c.set('resourceLimits', parseResourceLimitsFromHeadersWithDefaults(c, options))
    await next()
  })
