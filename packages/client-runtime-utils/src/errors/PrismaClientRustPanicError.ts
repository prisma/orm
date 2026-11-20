import { setClassName } from './setClassName'

export class PrismaClientRustPanicError extends Error {
  clientVersion: string

  constructor(message: string, clientVersion: string) {
    super(message)
    this.name = 'PrismaClientRustPanicError'

    this.clientVersion = clientVersion
  }
  get [Symbol.toStringTag]() {
    return 'PrismaClientRustPanicError'
  }
}

setClassName(PrismaClientRustPanicError, 'PrismaClientRustPanicError')
