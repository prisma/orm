import { type ChildProcessByStdio, fork } from 'node:child_process'
import readline from 'node:readline'

import { Debug } from '@prisma/debug'
import type { GeneratorConfig, GeneratorManifest, GeneratorOptions } from '@prisma/generator'
import { spawn } from 'cross-spawn'
import { bold } from 'kleur/colors'
import { Readable, Writable } from 'stream'

import * as JsonRpc from './json-rpc'

const debug = Debug('prisma:GeneratorProcess')

let globalMessageId = 1

type GeneratorProcessOptions = {
  isNode?: boolean
}

export class GeneratorError extends Error {
  name = 'GeneratorError'

  constructor(
    message: string,
    public code?: number,
    public data?: any,
  ) {
    super(message)
    if (data?.stack) {
      this.stack = data.stack
    }
  }
}

type ResultHandler<T = unknown> = {
  resolve: (value: T) => void
  reject: (error: Error) => void
}

export class GeneratorProcess {
  private child?: ChildProcessByStdio<Writable, null, Readable>
  private handlers: Record<string, ResultHandler> = {}
  private initPromise?: Promise<void>
  private isNode: boolean
  private errorLogs = ''
  private pendingError: Error | undefined
  private exited = false

  constructor(
    private pathOrCommand: string,
    { isNode = false }: GeneratorProcessOptions = {},
  ) {
    this.isNode = isNode
  }

  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initSingleton()
    }
    return this.initPromise
  }

  initSingleton(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isNode) {
        this.child = fork(this.pathOrCommand, [], {
          stdio: ['pipe', 'inherit', 'pipe', 'ipc'],
          env: {
            ...process.env,
            PRISMA_GENERATOR_INVOCATION: 'true',
          },
          // TODO: this assumes the host has at least 8 GB of RAM which may not be the case.
          execArgv: ['--max-old-space-size=8096'],
        }) as ChildProcessByStdio<Writable, null, Readable>
      } else {
        this.child = spawn(this.pathOrCommand, {
          stdio: ['pipe', 'inherit', 'pipe'],
          env: {
            ...process.env,
            PRISMA_GENERATOR_INVOCATION: 'true',
          },
          shell: true,
        })
      }

      this.child.on('exit', (code, signal) => {
        debug(`child exited with code ${code} on signal ${signal}`)
        this.exited = true

        if (code) {
          const error = new GeneratorError(
            `Generator ${JSON.stringify(this.pathOrCommand)} failed:\n\n${this.errorLogs}`,
          )
          this.pendingError = error
          this.rejectAllHandlers(error)
        }
      })

      // Set the error handler for stdin to prevent unhandled error events.
      // We handle write errors explicitly in `sendMessage` method.
      this.child.stdin.on('error', () => {})

      this.child.on('error', (error) => {
        debug(error)
        this.pendingError = error

        // Handle startup errors: reject the `init` promise.
        if ((error as NodeJS.ErrnoException).code === 'EACCES') {
          reject(
            new Error(
              `The executable at ${this.pathOrCommand} lacks the right permissions. Please use ${bold(
                `chmod +x ${this.pathOrCommand}`,
              )}`,
            ),
          )
        } else {
          reject(error)
        }

        // Reject any pending requests if the error event happened after spawning.
        this.rejectAllHandlers(error)
      })

      const stderrInterface = readline.createInterface({
        input: this.child.stderr,
        crlfDelay: Infinity,
      })

      stderrInterface.on('line', (line: string) => {
        let data: JsonRpc.Response | undefined
        try {
          data = JSON.parse(line)
        } catch (e) {
          this.errorLogs += line + '\n'
          debug(line)
        }
        if (data) {
          this.handleResponse(data)
        }
      })

      this.child.on('spawn', resolve)
    })
  }

  private rejectAllHandlers(error: Error) {
    for (const id of Object.keys(this.handlers)) {
      this.handlers[id].reject(error)
      delete this.handlers[id]
    }
  }

  private handleResponse(data: JsonRpc.Response): void {
    if (data.jsonrpc && data.id) {
      if (typeof data.id !== 'number') {
        throw new Error(`message.id has to be a number. Found value ${data.id}`)
      }
      if (this.handlers[data.id]) {
        if (JsonRpc.isErrorResponse(data)) {
          const error = new GeneratorError(data.error.message, data.error.code, data.error.data)
          this.handlers[data.id].reject(error)
        } else {
          this.handlers[data.id].resolve(data.result)
        }
        delete this.handlers[data.id]
      }
    }
  }

  private sendMessage(message: JsonRpc.Request, callback: (error?: Error) => void): void {
    if (!this.child) {
      callback(new GeneratorError('Generator process has not started yet'))
      return
    }

    if (!this.child.stdin.writable) {
      callback(new GeneratorError('Cannot send data to the generator process, process already exited'))
      return
    }

    this.child.stdin.write(JSON.stringify(message) + '\n', (error) => {
      if (!error) {
        return callback()
      }

      if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
        // Child process already terminated but we didn't know about it yet on Node.js side, so the `exit` event hasn't
        // been emitted yet, and the `child.stdin.writable` check also passed. We skip this error and let the `exit`
        // event handler reject active requests (including this one).
        return callback()
      }

      callback(error)
    })
  }

  private getMessageId(): number {
    return globalMessageId++
  }

  stop(): void {
    if (this.child && !this.child?.killed) {
      // Before `5.10.0` we were not passing explicitly a signal (so using the default `SIGTERM` signal)
      // the "should work with a custom generator" test was failing very often on macOS (in CI) with a timeout for example
      //
      // See https://www.gnu.org/software/libc/manual/html_node/Termination-Signals.html
      // The SIGTERM signal is a generic signal used to cause program termination. Unlike SIGKILL, this signal can be blocked, handled, and ignored. It is the normal way to politely ask a program to terminate.
      // The SIGKILL signal is used to cause immediate program termination. It cannot be handled or ignored, and is therefore always fatal. It is also not possible to block this signal.

      // We send SIGTERM first, and if the process is still alive after 2 seconds, we send SIGKILL
      this.child.kill('SIGTERM')

      const timeoutMs = 2_000
      const intervalMs = 200
      let interval: NodeJS.Timeout | undefined
      let timeout: NodeJS.Timeout | undefined
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      Promise.race([
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, timeoutMs)
        }),
        new Promise<string>((resolve) => {
          interval = setInterval(() => {
            if (this.exited) {
              return resolve('exited')
            }
          }, intervalMs)
        }),
      ])
        .then((result) => {
          if (result !== 'exited') {
            this.child?.kill('SIGKILL')
          }
        })
        .finally(() => {
          clearInterval(interval)
          clearTimeout(timeout)
        })
    }
  }

  private rpcMethod<T, U>(method: string, mapResult: (x: unknown) => U = (x) => x as U): (arg: T) => Promise<U> {
    return (params: T): Promise<U> =>
      new Promise((resolve, reject) => {
        if (this.pendingError) {
          reject(this.pendingError)
          return
        }

        const messageId = this.getMessageId()

        this.handlers[messageId] = {
          resolve: (result) => resolve(mapResult(result)),
          reject,
        }

        this.sendMessage(
          {
            jsonrpc: '2.0',
            method,
            params,
            id: messageId,
          },
          (error) => {
            if (error) reject(error)
          },
        )
      })
  }

  getManifest = this.rpcMethod<GeneratorConfig, GeneratorManifest | null>(
    'getManifest',
    (result) => (result as { manifest?: GeneratorManifest | null }).manifest ?? null,
  )

  generate = this.rpcMethod<GeneratorOptions, void>('generate')
}
