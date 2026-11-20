import readline from 'node:readline'

import type { Datasource } from '@prisma/config'
import Debug from '@prisma/debug'
import {
  BinaryType,
  ErrorArea,
  type MigrateTypes,
  relativizePathInPSLError,
  resolveBinary,
  RustPanic,
  SchemaContext,
  SchemaEngineExitCode,
  SchemaEngineLogLine,
  setClassName,
} from '@prisma/internals'
import type { ChildProcess } from 'child_process'
import { spawn } from 'child_process'
import { bold, red } from 'kleur/colors'

import { Extension, SchemaExtensionConfig } from './extensions'
import type { SchemaEngine } from './SchemaEngine'
import type { EngineArgs, EngineResults, RPCPayload, RpcSuccessResponse } from './types'
import { handleViewsIO } from './views/handleViewsIO'

const debugRpc = Debug('prisma:schemaEngine:rpc')
const debugStderr = Debug('prisma:schemaEngine:stderr')
const debugStdin = Debug('prisma:schemaEngine:stdin')

export class EngineError extends Error {
  public code: number
  constructor(message: string, code: number) {
    super(message)
    this.code = code
  }
}

setClassName(EngineError, 'EngineError')

// Is incremented every time `getRPCPayload` is called
let messageId = 1

interface SchemaEngineCLISetupInput {
  datasource?: Datasource
  debug?: boolean
  enabledPreviewFeatures?: string[]
  schemaContext?: SchemaContext
  extensions?: Extension[]
  baseDir: string
}

export type SchemaEngineCLIOptions = SchemaEngineCLISetupInput

export class SchemaEngineCLI implements SchemaEngine {
  private debug: boolean
  private child?: ChildProcess
  private schemaContext?: SchemaContext
  private datasource?: Datasource
  private listeners: { [key: string]: (result: any, err?: any) => any } = {}
  /**  _All_ the logs from the engine process. */
  private messages: string[] = []
  private lastRequest?: any
  /** The fields of the last engine log event with an `ERROR` level. */
  private lastError: SchemaEngineLogLine['fields'] | null = null
  private initPromise?: Promise<void>
  private enabledPreviewFeatures?: string[]
  private extensionConfig?: SchemaExtensionConfig
  private baseDir: string

  // `isRunning` is set to true when the engine is initialized, and set to false when the engine is stopped
  public isRunning = false

  private constructor({
    debug = false,
    schemaContext,
    datasource,
    enabledPreviewFeatures,
    extensions,
    baseDir,
  }: SchemaEngineCLIOptions) {
    this.schemaContext = schemaContext
    this.datasource = datasource
    if (debug) {
      Debug.enable('SchemaEngine*')
    }
    this.debug = debug
    this.enabledPreviewFeatures = enabledPreviewFeatures
    this.extensionConfig = extensions ? { types: extensions.flatMap((ext) => ext.types) } : undefined
    this.baseDir = baseDir
  }

  static setup(input: SchemaEngineCLISetupInput): Promise<SchemaEngineCLI> {
    return Promise.resolve(new SchemaEngineCLI(input))
  }

  //
  // See JSON-RPC API definition:
  // https://prisma.github.io/prisma-engines/doc/migration_core/json_rpc/index.html
  //

  /**
   * Apply the migrations from the migrations directory to the database.
   * This is the command behind prisma migrate deploy.
   */
  public applyMigrations(args: EngineArgs.ApplyMigrationsInput): Promise<EngineResults.ApplyMigrationsOutput> {
    return this.runCommand(this.getRPCPayload('applyMigrations', args))
  }

  /**
   * Create the logical database from the Prisma schema.
   */
  public createDatabase(args: EngineArgs.CreateDatabaseInput): Promise<EngineResults.CreateDatabaseOutput> {
    return this.runCommand(this.getRPCPayload('createDatabase', args))
  }

  /**
   * Create the next migration in the migrations history.
   * If draft is false and there are no unexecutable steps, it will also apply the newly created migration.
   * Note: This will use the shadow database on the connectors where we need one.
   */
  public createMigration(args: EngineArgs.CreateMigrationInput): Promise<EngineResults.CreateMigrationOutput> {
    return this.runCommand(this.getRPCPayload('createMigration', args))
  }

  /**
   * Execute a database script directly on the specified live database.
   * Note that this may not be defined on all connectors.
   */
  public dbExecute(args: EngineArgs.DbExecuteInput): Promise<EngineResults.DbExecuteOutput> {
    return this.runCommand(this.getRPCPayload('dbExecute', args))
  }

  /**
   * Make the Schema engine panic. Only useful to test client error handling.
   */
  public debugPanic(): Promise<void> {
    return this.runCommand(this.getRPCPayload('debugPanic', undefined))
  }

  /**
   * The method called at the beginning of migrate dev to decide the course of action,
   * based on the current state of the workspace.
   * It acts as a wrapper around diagnoseMigrationHistory.
   * Its role is to interpret the diagnostic output,
   * and translate it to a concrete action to be performed by the CLI.
   */
  public devDiagnostic(args: EngineArgs.DevDiagnosticInput): Promise<EngineResults.DevDiagnosticOutput> {
    return this.runCommand(this.getRPCPayload('devDiagnostic', args))
  }

  /**
   * Read the contents of the migrations directory and the migrations table, and returns their relative statuses.
   * At this stage, the Schema engine only reads,
   * it does not write to the database nor the migrations directory, nor does it use a shadow database.
   */
  public diagnoseMigrationHistory(
    args: EngineArgs.DiagnoseMigrationHistoryInput,
  ): Promise<EngineResults.DiagnoseMigrationHistoryOutput> {
    return this.runCommand(this.getRPCPayload('diagnoseMigrationHistory', args))
  }

  /**
   * Make sure the Schema engine can connect to the database from the Prisma schema.
   */
  public ensureConnectionValidity(args: EngineArgs.EnsureConnectionValidityInput): Promise<void> {
    return this.runCommand(this.getRPCPayload('ensureConnectionValidity', args))
  }

  /**
   * Development command for migrations.
   * Evaluate the data loss induced by the next migration the engine would generate on the main database.
   */
  public evaluateDataLoss(args: EngineArgs.EvaluateDataLossInput): Promise<EngineResults.EvaluateDataLossOutput> {
    return this.runCommand(this.getRPCPayload('evaluateDataLoss', args))
  }

  public getDatabaseDescription(schema: string): Promise<string> {
    return this.runCommand(this.getRPCPayload('getDatabaseDescription', { schema }))
  }

  /**
   * Get the database version for error reporting.
   * If no argument is given, the version of the database associated to the Prisma schema provided
   * in the constructor will be returned.
   */
  public getDatabaseVersion(args?: MigrateTypes.GetDatabaseVersionParams): Promise<string> {
    return this.runCommand(this.getRPCPayload('getDatabaseVersion', args))
  }

  /**
   * Given a Prisma schema, introspect the database definitions and update the schema with the results.
   * `compositeTypeDepth` is optional, and only required for MongoDB.
   */
  public async introspect({
    schema,
    force = false,
    baseDirectoryPath,
    viewsDirectoryPath,
    compositeTypeDepth = -1, // cannot be undefined
    namespaces,
  }: EngineArgs.IntrospectParams): Promise<EngineArgs.IntrospectResult> {
    try {
      const introspectResult: EngineArgs.IntrospectResult = await this.runCommand(
        this.getRPCPayload('introspect', { schema, force, compositeTypeDepth, namespaces, baseDirectoryPath }),
      )

      const { views } = introspectResult

      if (views) {
        await handleViewsIO({ views, viewsDirectoryPath })
      }

      return introspectResult
    } finally {
      // stop the engine after either a successful or failed introspection, to emulate how the
      // introspection engine used to work.
      await this.stop()
    }
  }

  /**
   * Compares two databases schemas from two arbitrary sources,
   * and display the difference as either a human-readable summary,
   * or an executable script that can be passed to dbExecute.
   * Connection to a shadow database is only necessary when either the from or the to params is a migrations directory.
   * Diffs have a direction. Which source is from and which is to matters.
   * The resulting diff should be thought of as a migration from the schema in `args.from` to the schema in `args.to`.
   * By default, we output a human-readable diff. If you want an executable script, pass the "script": true param.
   */
  public migrateDiff(args: EngineArgs.MigrateDiffInput): Promise<EngineResults.MigrateDiffOutput> {
    return this.runCommand(this.getRPCPayload('diff', args))
  }

  /**
   * Mark a migration as applied in the migrations table.
   * There are two possible outcomes:
   * - The migration is already in the table, but in a failed state. In this case, we will mark it as rolled back, then create a new entry.
   * - The migration is not in the table. We will create a new entry in the migrations table. The started_at and finished_at will be the same.
   * If it is already applied, we return a user-facing error.
   */
  public markMigrationApplied(args: EngineArgs.MarkMigrationAppliedInput): Promise<void> {
    return this.runCommand(this.getRPCPayload('markMigrationApplied', args))
  }

  /**
   * Mark an existing failed migration as rolled back in the migrations table. It will still be there, but ignored for all purposes except as audit trail.
   */
  public markMigrationRolledBack(args: EngineArgs.MarkMigrationRolledBackInput): Promise<void> {
    return this.runCommand(this.getRPCPayload('markMigrationRolledBack', args))
  }

  /**
   * Try to make the database empty: no data and no schema.
   * On most connectors, this is implemented by dropping and recreating the database.
   * If that fails (most likely because of insufficient permissions),
   * the engine attempts a “best effort reset” by inspecting the contents of the database and dropping them individually.
   * Drop and recreate the database. The migrations will not be applied, as it would overlap with applyMigrations.
   */
  reset(args: EngineArgs.MigrateResetInput): Promise<void> {
    return this.runCommand(this.getRPCPayload('reset', args))
  }

  /**
   * The command behind db push.
   */
  public schemaPush(args: EngineArgs.SchemaPushInput): Promise<EngineResults.SchemaPush> {
    return this.runCommand(this.getRPCPayload('schemaPush', args))
  }

  /**
   * SQL introspection that powers TypedSQL feature
   * @param args
   * @returns
   */
  public introspectSql(args: EngineArgs.IntrospectSqlParams): Promise<EngineResults.IntrospectSqlOutput> {
    return this.runCommand(this.getRPCPayload('introspectSql', args))
  }

  public async stop(): Promise<void> {
    if (!this.child) {
      return
    }

    const result = new Promise<void>((resolve) => {
      // Terminate the child process after a timeout if it's still running. On
      // Unix, this will send a SIGTERM signal to the process, which the schema
      // engine will handle and initiate a graceful shutdown. Since it has its
      // own timeout mechanism, we shouldn't wait before sending the signal,
      // otherwise these timeouts will add up. On Windows, there are no signals
      // and the kill method will terminate the process immediately, similar to
      // SIGKILL on Unix, so we should wait to give the schema engine a chance
      // to gracefully shut down in response to EOF in stdin.
      const timer = setTimeout(
        () => {
          this.child?.kill()
          resolve()
        },
        process.platform === 'win32' ? 4000 : 0,
      ).unref()

      this.child!.on('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })

    // Close stdin to tell the schema engine to stop the RPC server and exit.
    this.child.stdin?.end()

    this.isRunning = false

    return result
  }

  private rejectAll(err: any): void {
    Object.entries(this.listeners).map(([id, listener]) => {
      listener(null, err)
      delete this.listeners[id]
    })
  }

  private registerCallback(id: number, callback: (result: any, err?: Error) => any): void {
    this.listeners[id] = callback
  }

  private handleResponse(response: any): void {
    let result
    try {
      result = JSON.parse(response)
    } catch (e) {
      console.error(`Could not parse Schema engine response: ${response.slice(0, 200)}. Error: ${e.message}`)
    }

    // See https://www.jsonrpc.org/specification for the expected shape of messages.
    if (result) {
      // It's a response
      if (result.id && (result.result !== undefined || result.error !== undefined)) {
        if (!this.listeners[result.id]) {
          console.error(`Got result for unknown id ${result.id}`)
        }
        if (this.listeners[result.id]) {
          this.listeners[result.id](result)
          delete this.listeners[result.id]
        }
      } else if (result.method) {
        // This is a request.
        if (result.id !== undefined) {
          if (result.method === 'print' && result.params?.content !== undefined) {
            // Here we print the content from the Schema Engine to stdout directly
            // (it is not returned to the caller)
            process.stdout.write(result.params.content + '\n')

            // Send an empty response back as ACK.
            const response: RpcSuccessResponse<{}> = {
              id: result.id,
              jsonrpc: '2.0',
              result: {},
            }
            this.child!.stdin!.write(JSON.stringify(response) + '\n')
          }
        }
      }
    }
  }

  private init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.internalInit()
    }

    return this.initPromise
  }

  private internalInit(): Promise<void> {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      try {
        const { PWD, ...processEnv } = process.env
        const binaryPath = await resolveBinary(BinaryType.SchemaEngineBinary)
        debugRpc('starting Schema engine with binary: ' + binaryPath)
        const args: string[] = []

        if (this.schemaContext) {
          // list of paths to the schema files
          const schemaArgs = this.schemaContext.schemaFiles.flatMap(([path]) => ['--datamodels', path])
          args.push(...schemaArgs)
        }

        if (this.datasource) {
          args.push(...['--datasource', JSON.stringify(this.datasource)])
        }

        if (
          this.enabledPreviewFeatures &&
          Array.isArray(this.enabledPreviewFeatures) &&
          this.enabledPreviewFeatures.length > 0
        ) {
          args.push(...['--enabled-preview-features', this.enabledPreviewFeatures.join(',')])
        }

        if (this.extensionConfig) {
          args.push(...['--extension-types', JSON.stringify(this.extensionConfig)])
        }

        this.child = spawn(binaryPath, args, {
          cwd: this.baseDir,
          stdio: ['pipe', 'pipe', this.debug ? process.stderr : 'pipe'],
          env: {
            // The following environment variables can be overridden by the user.
            RUST_LOG: 'info',
            RUST_BACKTRACE: '1',
            // Take env values from process.env (will override values set before)
            ...processEnv,
          },
        })

        this.isRunning = true

        this.child.on('error', (err) => {
          console.error('[schema-engine] error: %s', err)
          this.rejectAll(err)
          reject(err)
        })

        this.child.on('exit', (code: number | null): void => {
          const exitWithErr = (err: RustPanic | Error): void => {
            this.rejectAll(err)
            reject(err)
          }
          const processMessages = this.messages.join('\n')
          const engineMessage = this.lastError?.message || processMessages
          const handlePanic = () => {
            /**
             * Example:
             *
             * ```
             * [EXIT_PANIC]
             * Starting Schema engine RPC server
             * The migration was not applied because it triggered warnings and the force flag was not passed
             * 0: backtrace::capture::Backtrace::new
             * 1: schema_engine::set_panic_hook::{{closure}}
             * 2: std::panicking::rust_panic_with_hook
             * 3: std::panicking::begin_panic_handler::{{closure}}
             * ...
             * 18: __pthread_deallocate
             * ```
             */
            const stackTrace = `[EXIT_PANIC]\n${processMessages}\n${this.lastError?.backtrace ?? ''}`

            exitWithErr(new RustPanic(serializePanic(engineMessage), stackTrace, this.lastRequest, ErrorArea.LIFT_CLI))
          }

          switch (code) {
            case SchemaEngineExitCode.Success:
              break
            case SchemaEngineExitCode.Error:
              exitWithErr(new Error(`Error in Schema engine: ${engineMessage}`))
              break
            case SchemaEngineExitCode.Panic:
              handlePanic()
              break
            // treat unknown error codes as panics
            default:
              handlePanic()
          }
        })

        this.child.stdin!.on('error', (err) => {
          debugStdin(err)
        })

        // logs (info, error)
        // error can be a panic
        const stderrInterface = readline.createInterface({
          input: this.child.stderr!,
          crlfDelay: Infinity,
        })

        stderrInterface.on('line', (line: string) => {
          debugStderr(line)

          try {
            const json: SchemaEngineLogLine = JSON.parse(line)

            this.messages.push(json.fields.message)

            if (json.level === 'ERROR') {
              this.lastError = json.fields
            }
          } catch (e) {
            //
          }
        })

        const stdoutInterface = readline.createInterface({
          input: this.child.stdout!,
          crlfDelay: Infinity,
        })

        stdoutInterface.on('line', (line: string) => {
          this.handleResponse(line)
        })

        setImmediate(() => {
          resolve()
        })
      } catch (e) {
        reject(e)
      }
    })
  }

  private async runCommand(request: RPCPayload): Promise<any> {
    if (process.env.FORCE_PANIC_SCHEMA_ENGINE && request.method !== 'getDatabaseVersion') {
      request = this.getRPCPayload('debugPanic', undefined)
    }

    await this.init()

    if (this.child?.killed) {
      throw new Error(`Can't execute ${JSON.stringify(request)} because Schema engine already exited.`)
    }

    return new Promise((resolve, reject) => {
      this.registerCallback(request.id, (response, err) => {
        if (err) {
          return reject(err)
        }

        // can be null, for reset RPC for example
        if (response.result !== undefined) {
          resolve(response.result)
        } else {
          if (response.error) {
            debugRpc(response)
            if (response.error.data?.is_panic) {
              // TODO(jkomyno): I suspect no panic is ever thrown here

              const message = response.error.data?.error?.message ?? response.error.message

              // explicitly mark the error as a "response error panic" to distinguish it from the other one.
              // This will allow us to track the frequency of this particular panic in the error reporting system.
              const stackTrace = `[RESPONSE_ERROR_PANIC]\n${response.error.data?.message ?? ''}`

              reject(
                // Handle error and displays the interactive dialog to send panic error
                new RustPanic(message, stackTrace, this.lastRequest, ErrorArea.LIFT_CLI),
              )
            } else if (response.error.data?.message) {
              // Print known error code & message from engine
              // See known errors at https://github.com/prisma/specs/tree/master/errors#prisma-sdk
              let message = `${red(relativizePathInPSLError(response.error.data.message))}\n`
              if (response.error.data?.error_code) {
                message = red(`${response.error.data.error_code}\n\n`) + message
                reject(new EngineError(message, response.error.data.error_code))
              } else {
                reject(new Error(message))
              }
            } else {
              reject(
                new Error(
                  `${red('Error in RPC')}\n Request: ${JSON.stringify(request, null, 2)}\nResponse: ${JSON.stringify(
                    response,
                    null,
                    2,
                  )}\n${response.error.message}\n`,
                ),
              )
            }
          } else {
            reject(new Error(`Got invalid RPC response without .result property: ${JSON.stringify(response)}`))
          }
        }
      })

      if (this.child!.stdin!.destroyed) {
        throw new Error(`Can't execute ${JSON.stringify(request)} because Schema engine is destroyed.`)
      }

      debugRpc('SENDING RPC CALL', JSON.stringify(request))
      this.child!.stdin!.write(JSON.stringify(request) + '\n')
      this.lastRequest = request
    })
  }

  private getRPCPayload(method: string, params: unknown): RPCPayload {
    return {
      id: messageId++,
      jsonrpc: '2.0',
      method,
      params: params
        ? {
            ...params,
          }
        : undefined,
    }
  }
}

/** The full message with context we return to the user in case of engine panic. */
function serializePanic(log: string): string {
  return `${red(bold('Error in Schema engine.\nReason: '))}${log}\n`
}
