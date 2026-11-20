import Debug from '@prisma/debug'
import type { ErrorCapturingSqlMigrationAwareDriverAdapterFactory, ErrorRegistry } from '@prisma/driver-adapter-utils'
import {
  assertAlways,
  ErrorArea,
  getWasmError,
  isWasmPanic,
  relativizePathInPSLError,
  RustPanic,
  SchemaContext,
  wasm,
  wasmSchemaEngineLoader,
} from '@prisma/internals'
import { bold, red } from 'kleur/colors'

import { SchemaEngine } from './SchemaEngine'
import { EngineError } from './SchemaEngineCLI'
import { EngineArgs } from './types'
import { handleViewsIO } from './views/handleViewsIO'

const debugStderr = Debug('prisma:schemaEngine:wasm:stderr')
const debugStdout = Debug('prisma:schemaEngine:wasm:stdout')

type SchemaEngineMethods = Omit<wasm.SchemaEngineWasm, 'free'>
export type SchemaEngineInput<M extends keyof SchemaEngineMethods> = Parameters<wasm.SchemaEngineWasm[M]>[0]
export type SchemaEngineOutput<M extends keyof SchemaEngineMethods> = ReturnType<wasm.SchemaEngineWasm[M]>

interface SchemaEngineWasmSetupInput {
  adapter: ErrorCapturingSqlMigrationAwareDriverAdapterFactory
  enabledPreviewFeatures?: string[]
  schemaContext?: SchemaContext
}

export interface SchemaEngineWasmOptions extends Omit<SchemaEngineWasmSetupInput, 'adapter'> {
  debug?: boolean
  engine: wasm.SchemaEngineWasm
  errorRegistry: ErrorRegistry
}

/**
 * Wrapper around `@prisma/schema-engine-wasm`, which will eventually replace `SchemaEngineCLI`.
 *
 * TODOs:
 * - Catch and throw "rich" connector errors
 */
export class SchemaEngineWasm implements SchemaEngine {
  private engine: wasm.SchemaEngineWasm
  private errorRegistry: ErrorRegistry

  // TODO: forward enabled preview features to the Wasm engine
  private enabledPreviewFeatures?: string[]

  // `isRunning` is set to true when the engine is initialized, and set to false when the engine is stopped
  public isRunning = false

  private constructor({ debug, enabledPreviewFeatures, engine, errorRegistry }: SchemaEngineWasmOptions) {
    this.enabledPreviewFeatures = enabledPreviewFeatures
    if (debug) {
      Debug.enable('prisma:schemaEngine*')
    }
    this.engine = engine
    this.errorRegistry = errorRegistry
  }

  static async setup({ adapter, schemaContext, ...rest }: SchemaEngineWasmSetupInput): Promise<SchemaEngineWasm> {
    const debug = (arg: string) => {
      debugStderr(arg)
    }

    // Note: `datamodels` must be either `undefined` or a *non-empty* `LoadedFile[]`.
    const datamodels = schemaContext?.schemaFiles
    const engine = await wasmSchemaEngineLoader.loadSchemaEngine(
      {
        datamodels,
      },
      debug,
      adapter,
    )
    return new SchemaEngineWasm({ ...rest, engine, errorRegistry: adapter.errorRegistry })
  }

  private async runCommand<M extends keyof SchemaEngineMethods>(
    command: M,
    input: SchemaEngineInput<M>,
  ): Promise<Awaited<SchemaEngineOutput<M>>> {
    if (process.env.FORCE_PANIC_SCHEMA_ENGINE && command !== 'debugPanic') return this.debugPanic()

    this.isRunning = true

    debugStdout('[%s] input: %o', command, input)

    try {
      // Don't modify this by extracting the method call into a variable,
      // as it breaks the binding to the WebAssembly instance, and triggers the
      // `TypeError: Cannot read properties of undefined (reading '__wbg_ptr')`
      // error.
      const result = await (this.engine[command] as (_: SchemaEngineInput<M>) => SchemaEngineOutput<M>)(input)
      debugStdout('[%s] result: %o', command, result)
      return result
    } catch (error) {
      const e = error as Error
      debugStdout('[%s] error: %o', command, e)

      if (isWasmPanic(e)) {
        debugStdout('[schema-engine] it is a Wasm panic')
        const { message, stack } = getWasmError(e)
        // Handle error and displays the interactive dialog to send panic error
        throw new RustPanic(serializePanic(message), stack, command, ErrorArea.LIFT_CLI)
      } else if ('code' in error) {
        throw new EngineError(red(`${error.code}\n\n${relativizePathInPSLError(error.message)}\n`), error.code)
      } else {
        assertAlways(
          e.name === 'SchemaConnectorError',
          'Malformed error received from the engine, expected SchemaConnectorError',
        )

        debugStderr('e.message', e.message)
        debugStderr('e.cause', e.cause)
        debugStderr('e.stack', e.stack)

        throw e
      }
    }
  }

  /**
   * Apply the migrations from the migrations directory to the database.
   * This is the command behind prisma migrate deploy.
   */
  public applyMigrations(input: SchemaEngineInput<'applyMigrations'>): SchemaEngineOutput<'applyMigrations'> {
    return this.runCommand('applyMigrations', input)
  }

  /**
   * Create the next migration in the migrations history.
   * If draft is false and there are no unexecutable steps, it will also apply the newly created migration.
   * Note: This will use the shadow database on the connectors where we need one.
   */
  public createMigration(input: SchemaEngineInput<'createMigration'>): SchemaEngineOutput<'createMigration'> {
    return this.runCommand('createMigration', input)
  }

  /**
   * Execute a database script directly on the specified live database.
   * Note that this may not be defined on all connectors.
   */
  public async dbExecute(input: SchemaEngineInput<'dbExecute'>) {
    await this.runCommand('dbExecute', input)
    return null
  }

  /**
   * Make the Schema engine panic. Only useful to test client error handling.
   */
  public async debugPanic() {
    await this.runCommand('debugPanic', undefined)
    return null as never
  }

  /**
   * The method called at the beginning of migrate dev to decide the course of action,
   * based on the current state of the workspace.
   * It acts as a wrapper around diagnoseMigrationHistory.
   * Its role is to interpret the diagnostic output,
   * and translate it to a concrete action to be performed by the CLI.
   */
  public devDiagnostic(input: SchemaEngineInput<'devDiagnostic'>): SchemaEngineOutput<'devDiagnostic'> {
    return this.runCommand('devDiagnostic', input)
  }

  /**
   * Read the contents of the migrations directory and the migrations table, and returns their relative statuses.
   * At this stage, the Schema engine only reads,
   * it does not write to the database nor the migrations directory, nor does it use a shadow database.
   */
  public diagnoseMigrationHistory(
    input: SchemaEngineInput<'diagnoseMigrationHistory'>,
  ): SchemaEngineOutput<'diagnoseMigrationHistory'> {
    return this.runCommand('diagnoseMigrationHistory', input)
  }

  /**
   * Make sure the Schema engine can connect to the database from the Prisma schema.
   */
  public async ensureConnectionValidity(input: SchemaEngineInput<'ensureConnectionValidity'>) {
    await this.runCommand('ensureConnectionValidity', input)
  }

  /**
   * Development command for migrations.
   * Evaluate the data loss induced by the next migration the engine would generate on the main database.
   */
  public evaluateDataLoss(input: SchemaEngineInput<'evaluateDataLoss'>): SchemaEngineOutput<'evaluateDataLoss'> {
    return this.runCommand('evaluateDataLoss', input)
  }

  /**
   * Get the database version for error reporting.
   * If no argument is given, the version of the database associated to the Prisma schema provided
   * in the constructor will be returned.
   */
  public getDatabaseVersion(input?: SchemaEngineInput<'version'>): SchemaEngineOutput<'version'> {
    return this.runCommand('version', input)
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
    compositeTypeDepth = -1,
    namespaces,
  }: EngineArgs.IntrospectParams): SchemaEngineOutput<'introspect'> {
    const introspectResult = await this.runCommand('introspect', {
      schema,
      force,
      compositeTypeDepth,
      namespaces: namespaces ?? null,
      baseDirectoryPath,
    })
    const { views } = introspectResult

    if (views) {
      await handleViewsIO({ views, viewsDirectoryPath })
    }

    return introspectResult
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
  public async migrateDiff(input: SchemaEngineInput<'diff'>) {
    const { stdout, ...rest } = await this.runCommand('diff', input)

    if (stdout) {
      // Here we print the content from the Schema Engine to stdout directly
      // (it is not returned to the caller)
      process.stdout.write(stdout)
    }

    return rest
  }

  /**
   * Mark a migration as applied in the migrations table.
   * There are two possible outcomes:
   * - The migration is already in the table, but in a failed state. In this case, we will mark it as rolled back, then create a new entry.
   * - The migration is not in the table. We will create a new entry in the migrations table. The started_at and finished_at will be the same.
   * If it is already applied, we return a user-facing error.
   */
  public async markMigrationApplied(input: SchemaEngineInput<'markMigrationApplied'>) {
    await this.runCommand('markMigrationApplied', input)
  }

  /**
   * Mark an existing failed migration as rolled back in the migrations table. It will still be there, but ignored for all purposes except as audit trail.
   */
  public async markMigrationRolledBack(input: SchemaEngineInput<'markMigrationRolledBack'>) {
    await this.runCommand('markMigrationRolledBack', input)
  }

  /**
   * Try to make the database empty: no data and no schema.
   * On most connectors, this is implemented by dropping and recreating the database.
   * If that fails (most likely because of insufficient permissions),
   * the engine attempts a “best effort reset” by inspecting the contents of the database and dropping them individually.
   * Drop and recreate the database. The migrations will not be applied, as it would overlap with applyMigrations.
   */
  public async reset(input: SchemaEngineInput<'reset'>) {
    await this.runCommand('reset', input)
  }

  /**
   * The command behind db push.
   */
  public schemaPush(input: SchemaEngineInput<'schemaPush'>): SchemaEngineOutput<'schemaPush'> {
    return this.runCommand('schemaPush', input)
  }

  /**
   * SQL introspection that powers TypedSQL feature
   * @param args
   * @returns
   */
  public introspectSql(input: SchemaEngineInput<'introspectSql'>): SchemaEngineOutput<'introspectSql'> {
    return this.runCommand('introspectSql', input)
  }

  /**
   * Stop the engine.
   */
  public stop(): Promise<void> {
    this.isRunning = false
    this.engine.free()
    return Promise.resolve()
  }
}

/** The full message with context we return to the user in case of engine panic. */
function serializePanic(log: string): string {
  return `${red(bold('Error in Schema engine.\nReason: '))}${log}\n`
}
