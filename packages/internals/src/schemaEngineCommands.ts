import { BinaryType } from '@prisma/fetch-engine'
import { execa, type ExecaError } from 'execa'

import { resolveBinary } from './resolveBinary'

// ### Exit codes
// `0`: normal exit
// `1`: abnormal (error) exit
// `101`: panic
// Non-zero exit codes should always be accompanied by a log message on stderr with the `ERROR` level.
export enum SchemaEngineExitCode {
  Success = 0,
  Error = 1,
  Panic = 101,
}

// Logging and crash reporting happens through JSON logs on the Schema Engine's
// stderr. Every line contains a single JSON object conforming to the following
// interface:
// {"timestamp":"2021-06-11T15:35:34.084486+00:00","level":"ERROR","fields":{"is_panic":false,"error_code":"","message":"Failed to delete SQLite database at `dev.db`.\nNo such file or directory (os error 2)\n"},"target":"schema_engine::logger"}
// {"timestamp":"2021-06-11T15:35:34.320358+00:00","level":"INFO","fields":{"message":"Starting schema engine CLI","git_hash":"a92947d63ede9b0b5b5aab253c2a7d9ad6cabe15"},"target":"schema_engine"}
export interface SchemaEngineLogLine {
  timestamp: string
  level: LogLevel
  fields: LogFields
  target: string
}
type LogLevel = 'INFO' | 'ERROR' | 'DEBUG' | 'WARN'
interface LogFields {
  message: string
  git_hash?: string
  // Only for ERROR level messages
  is_panic?: boolean
  error_code?: string
  backtrace?: string
  [key: string]: any
}

// https://github.com/prisma/specs/tree/master/errors#common
export type DatabaseErrorCodes = 'P1000' | 'P1001' | 'P1002' | 'P1003' | 'P1009' | 'P1010'

export type ConnectionResult = true | ConnectionError

export interface ConnectionError {
  message: string
  code: DatabaseErrorCodes
}

function parseJsonFromStderr(stderr: string): SchemaEngineLogLine[] {
  // split by new line
  const lines = stderr.split(/\r?\n/).slice(1) // Remove first element
  const logs: any = []

  for (const line of lines) {
    const data = String(line)
    try {
      const json: SchemaEngineLogLine = JSON.parse(data)
      logs.push(json)
    } catch (e) {
      throw new Error(`Could not parse schema engine response: ${e}`)
    }
  }

  return logs
}

// could be refactored with engines using JSON RPC instead and just passing the schema
export async function canConnectToDatabase(
  connectionString: string,
  cwd = process.cwd(),
  schemaEnginePath?: string,
): Promise<ConnectionResult> {
  if (!connectionString) {
    throw new Error('Connection url is empty. See https://pris.ly/d/config-url')
  }

  try {
    await execaCommand({
      connectionString,
      cwd,
      schemaEnginePath: schemaEnginePath,
      engineCommandName: 'can-connect-to-database',
    })
  } catch (_e) {
    const e = _e as ExecaError

    if (e.stderr) {
      const logs = parseJsonFromStderr(e.stderr)
      const error = logs.find((it) => it.level === 'ERROR' && it.target === 'schema_engine::logger')

      if (error && error.fields.error_code && error.fields.message) {
        return {
          code: error.fields.error_code as DatabaseErrorCodes,
          message: error.fields.message,
        }
      } else {
        throw new Error(`Schema engine error:\n${logs.map((log) => log.fields.message).join('\n')}`)
      }
    } else {
      throw new Error(`Schema engine exited. ${_e}`)
    }
  }

  return true
}

// could be refactored with engines using JSON RPC instead and just passing the schema
export async function createDatabase(connectionString: string, cwd = process.cwd(), schemaEnginePath?: string) {
  const dbExists = await canConnectToDatabase(connectionString, cwd, schemaEnginePath)

  // If database is already created, stop here, don't create it
  if (dbExists === true) {
    return false
  }

  try {
    await execaCommand({
      connectionString,
      cwd,
      schemaEnginePath,
      engineCommandName: 'create-database',
    })

    return true
  } catch (_e) {
    const e = _e as ExecaError

    if (e.stderr) {
      const logs = parseJsonFromStderr(e.stderr)
      const error = logs.find((it) => it.level === 'ERROR' && it.target === 'schema_engine::logger')

      if (error && error.fields.error_code && error.fields.message) {
        throw new Error(`${error.fields.error_code}: ${error.fields.message}`)
      } else {
        throw new Error(`Schema engine error:\n${logs.map((log) => log.fields.message).join('\n')}`)
      }
    } else {
      throw new Error(`Schema engine exited. ${_e}`)
    }
  }
}

export async function dropDatabase(connectionString: string, cwd = process.cwd(), schemaEnginePath?: string) {
  try {
    const result = await execaCommand({
      connectionString,
      cwd,
      schemaEnginePath,
      engineCommandName: 'drop-database',
    })
    if (result && result.exitCode === 0 && result.stderr.includes('The database was successfully dropped')) {
      return true
    } else {
      // We should not arrive here normally
      throw Error(`An error occurred during the drop: ${JSON.stringify(result, undefined, 2)}`)
    }
  } catch (e: any) {
    if (e.stderr) {
      const logs = parseJsonFromStderr(e.stderr)

      throw new Error(`Schema engine error:\n${logs.map((log) => log.fields.message).join('\n')}`)
    } else {
      throw new Error(`Schema engine exited. ${e}`)
    }
  }
}

export async function execaCommand({
  connectionString,
  cwd,
  schemaEnginePath,
  engineCommandName,
}: {
  connectionString: string
  cwd: string
  schemaEnginePath?: string
  engineCommandName: 'create-database' | 'drop-database' | 'can-connect-to-database'
}) {
  schemaEnginePath = schemaEnginePath || (await resolveBinary(BinaryType.SchemaEngineBinary))

  try {
    return await execa(
      schemaEnginePath,
      ['--datasource', JSON.stringify({ url: connectionString }), 'cli', engineCommandName],
      {
        cwd,
        env: {
          RUST_BACKTRACE: process.env.RUST_BACKTRACE ?? '1',
          RUST_LOG: process.env.RUST_LOG ?? 'info',
        },
      },
    )
  } catch (_e) {
    const e = _e as ExecaError

    if (e.message) {
      e.message = e.message.replace(connectionString, '<REDACTED>')
    }
    if (e.stdout) {
      e.stdout = e.stdout.replace(connectionString, '<REDACTED>')
    }
    if (e.stderr) {
      e.stderr = e.stderr.replace(connectionString, '<REDACTED>')
    }
    throw e
  }
}
