import { stripVTControlCharacters } from 'node:util'

import { getBinaryTargetForCurrentPlatform } from '@prisma/get-platform'
import * as checkpoint from 'checkpoint-client'
import os from 'os'
import tmp from 'tmp'
import { match, P } from 'ts-pattern'

import { createErrorReport, type CreateErrorReportInput, ErrorKind, makeErrorReportCompleted } from './errorReporting'
import type { MigrateTypes } from './migrateTypes'
import type { RustPanic } from './panic'
import { ErrorArea } from './panic'

// cleanup the temporary files even when an uncaught exception occurs
tmp.setGracefulCleanup()

type SendPanic = {
  error: RustPanic
  cliVersion: string
  enginesVersion: string

  // retrieve the database version for the given schema or url, without throwing any error
  getDatabaseVersionSafe: (args: MigrateTypes.GetDatabaseVersionParams | undefined) => Promise<string | undefined>
}
export async function sendPanic({
  error,
  cliVersion,
  enginesVersion,
  getDatabaseVersionSafe,
}: SendPanic): Promise<number> {
  let dbVersion: string | undefined
  if (error.area === ErrorArea.LIFT_CLI) {
    // For a SQLite datasource configured as `file:dev.db` only schema will be defined
    const getDatabaseVersionParams: MigrateTypes.GetDatabaseVersionParams | undefined = match({
      introspectionUrl: error.introspectionUrl,
    })
      .with({ introspectionUrl: P.not(undefined) }, ({ introspectionUrl }) => {
        return {
          datasource: {
            tag: 'ConnectionString',
            url: introspectionUrl,
          },
        } as const
      })
      .otherwise(() => undefined)

    dbVersion = await getDatabaseVersionSafe(getDatabaseVersionParams)
  }

  const migrateRequest = error.request ? JSON.stringify(error.request) : undefined

  const params: CreateErrorReportInput = {
    area: error.area,
    kind: ErrorKind.RUST_PANIC,
    cliVersion,
    binaryVersion: enginesVersion,
    command: getCommand(),
    jsStackTrace: stripVTControlCharacters(error.stack || error.message),
    rustStackTrace: error.rustStack,
    operatingSystem: `${os.arch()} ${os.platform()} ${os.release()}`,
    platform: await getBinaryTargetForCurrentPlatform(),
    liftRequest: migrateRequest,
    fingerprint: await checkpoint.getSignature(),
    sqlDump: undefined,
    dbVersion: dbVersion,
  }

  // Get an AWS S3 signed URL from the server, so we can upload a zip file
  const signedUrl = await createErrorReport(params)

  // Mark the error report as completed
  const id = await makeErrorReportCompleted(signedUrl)

  return id
}

function getCommand(): string {
  // don't send url
  if (process.argv[2] === 'db' && process.argv[3] === 'pull') {
    return 'db pull'
  }
  return process.argv.slice(2).join(' ')
}
