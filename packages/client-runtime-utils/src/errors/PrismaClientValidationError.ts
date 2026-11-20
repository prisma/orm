import { setClassName } from './setClassName'

type Options = {
  clientVersion: string
}
export class PrismaClientValidationError extends Error {
  name = 'PrismaClientValidationError'
  clientVersion: string

  constructor(message: string, { clientVersion }: Options) {
    super(message)
    this.clientVersion = clientVersion
  }

  get [Symbol.toStringTag]() {
    return 'PrismaClientValidationError'
  }
}
setClassName(PrismaClientValidationError, 'PrismaClientValidationError')
