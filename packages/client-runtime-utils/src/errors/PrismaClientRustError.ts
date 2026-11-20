import { getBacktrace, isPanic, type RustLog } from './log'
import { setClassName } from './setClassName'

export type PrismaClientRustErrorArgs = {
  clientVersion: string
  error: RustLog
}

/**
 * A generic Prisma Client Rust error.
 * This error is being exposed via the `prisma.$on('error')` interface
 */
export class PrismaClientRustError extends Error {
  clientVersion: string
  private _isPanic: boolean

  constructor({ clientVersion, error }: PrismaClientRustErrorArgs) {
    const backtrace = getBacktrace(error)
    super(backtrace ?? 'Unknown error')

    this._isPanic = isPanic(error)
    this.clientVersion = clientVersion
  }

  get [Symbol.toStringTag]() {
    return 'PrismaClientRustError'
  }

  public isPanic(): boolean {
    return this._isPanic
  }
}

setClassName(PrismaClientRustError, 'PrismaClientRustError')
