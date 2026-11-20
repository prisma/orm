import { setClassName } from '@prisma/internals'

import type { AccelerateErrorInfo } from './accelerate-error'
import { AccelerateError } from './accelerate-error'
import { setRetryable } from './utils/set-retryable'

export interface InvalidDatasourceErrorInfo extends AccelerateErrorInfo {}
export class InvalidDatasourceError extends AccelerateError {
  public name = 'InvalidDatasourceError'
  public code = 'P6001'

  constructor(message: string, info: InvalidDatasourceErrorInfo) {
    super(message, setRetryable(info, false))
  }
}
setClassName(InvalidDatasourceError, 'InvalidDatasourceError')
