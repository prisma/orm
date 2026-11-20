import { ErrorWithBatchIndex } from './ErrorWithBatchIndex'
import { setClassName } from './setClassName'

type UnknownErrorParams = {
  clientVersion: string
  batchRequestIdx?: number
}

export class PrismaClientUnknownRequestError extends Error implements ErrorWithBatchIndex {
  clientVersion: string
  batchRequestIdx?: number

  constructor(message: string, { clientVersion, batchRequestIdx }: UnknownErrorParams) {
    super(message)
    this.name = 'PrismaClientUnknownRequestError'

    this.clientVersion = clientVersion
    Object.defineProperty(this, 'batchRequestIdx', {
      value: batchRequestIdx,
      writable: true,
      enumerable: false,
    })
  }
  get [Symbol.toStringTag]() {
    return 'PrismaClientUnknownRequestError'
  }
}

setClassName(PrismaClientUnknownRequestError, 'PrismaClientUnknownRequestError')
