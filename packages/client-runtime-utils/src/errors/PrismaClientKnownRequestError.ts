import { ErrorWithBatchIndex } from './ErrorWithBatchIndex'
import { setClassName } from './setClassName'

type KnownErrorParams = {
  code: string
  clientVersion: string
  meta?: Record<string, unknown>
  batchRequestIdx?: number
}

export class PrismaClientKnownRequestError extends Error implements ErrorWithBatchIndex {
  code: string
  meta?: Record<string, unknown>
  clientVersion: string
  batchRequestIdx?: number

  constructor(message: string, { code, clientVersion, meta, batchRequestIdx }: KnownErrorParams) {
    super(message)
    this.name = 'PrismaClientKnownRequestError'

    this.code = code
    this.clientVersion = clientVersion
    this.meta = meta
    Object.defineProperty(this, 'batchRequestIdx', {
      value: batchRequestIdx,
      enumerable: false,
      writable: true,
    })
  }
  get [Symbol.toStringTag]() {
    return 'PrismaClientKnownRequestError'
  }
}

setClassName(PrismaClientKnownRequestError, 'PrismaClientKnownRequestError')
