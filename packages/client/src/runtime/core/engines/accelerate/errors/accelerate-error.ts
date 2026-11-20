import { PrismaClientError, type PrismaClientErrorInfo } from '../../../errors/PrismaClientError'

export interface AccelerateErrorInfo extends PrismaClientErrorInfo {
  isRetryable?: boolean
}

export abstract class AccelerateError extends PrismaClientError {
  isRetryable: boolean

  constructor(message: string, info: AccelerateErrorInfo) {
    super(message, info)

    this.isRetryable = info.isRetryable ?? true
  }
}
