import { pathToPosix } from '@prisma/internals'
import * as stackTraceParser from 'stacktrace-parser'

import { ErrorFormat } from '../getPrismaClient'

declare global {
  /**
   * a global variable that is injected by us via jest to make our snapshots
   * work in clients that cannot read from disk (e.g. wasm or edge clients)
   */
  let $EnabledCallSite: typeof EnabledCallSite | undefined
}

export type LocationInFile = {
  fileName: string
  lineNumber: number | null
  columnNumber: number | null
}

export interface CallSite {
  getLocation(): LocationInFile | null
}

class DisabledCallSite implements CallSite {
  getLocation(): LocationInFile | null {
    return null
  }
}

export class EnabledCallSite implements CallSite {
  private _error: Error
  constructor() {
    this._error = new Error()
  }
  getLocation(): LocationInFile | null {
    const stack = this._error.stack
    if (!stack) {
      return null
    }
    const stackFrames = stackTraceParser.parse(stack)
    // TODO: more resilient logic to check that it's not relative to cwd
    const frame = stackFrames.find((t) => {
      // Here we are trying to find the location in the user's code which caused the error
      if (!t.file) {
        return false
      }

      // convert windows path to posix path
      const posixFile = pathToPosix(t.file)
      return (
        posixFile !== '<anonymous>' && // Ignore as we can not read an <anonymous> file
        !posixFile.includes('@prisma') && // Internal, unbundled code
        !posixFile.includes('/packages/client/src/runtime/') && // Runtime sources when source maps are used
        !posixFile.endsWith('/runtime/client.js') && // Bundled runtimes
        !posixFile.startsWith('internal/') && // We don't want internal nodejs files
        !t.methodName.includes('new ') && // "new CallSite" call and maybe other constructors
        !t.methodName.includes('getCallSite') && // getCallSite function from this module
        !t.methodName.includes('Proxy.') && // Model proxies
        t.methodName.split('.').length < 4
      )
    })

    if (!frame || !frame.file) {
      return null
    }

    return {
      fileName: frame.file,
      lineNumber: frame.lineNumber,
      columnNumber: frame.column,
    }
  }
}

export function getCallSite(errorFormat: ErrorFormat): CallSite {
  if (errorFormat === 'minimal' || TARGET_BUILD_TYPE === 'wasm-compiler-edge') {
    if (typeof $EnabledCallSite === 'function' && errorFormat !== 'minimal') {
      return new $EnabledCallSite()
    } else {
      return new DisabledCallSite()
    }
  } else {
    return new EnabledCallSite()
  }
}
