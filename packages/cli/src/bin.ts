#!/usr/bin/env tsx

import path from 'node:path'

import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { defaultConfig, InjectFormatters } from '@prisma/config'
import { Debug } from '@prisma/debug'
import { enginesVersion } from '@prisma/engines'
import { download } from '@prisma/fetch-engine'
import { arg, handlePanic, HelpError, isError, isRustPanic, link } from '@prisma/internals'
import {
  DbCommand,
  DbExecute,
  DbPull,
  DbPush,
  // DbDrop,
  DbSeed,
  getDatabaseVersionSafe,
  MigrateCommand,
  MigrateDeploy,
  MigrateDev,
  MigrateDiff,
  MigrateReset,
  MigrateResolve,
  MigrateStatus,
} from '@prisma/migrate'
import { bold, dim, red, yellow } from 'kleur/colors'

import { Bootstrap } from './bootstrap/Bootstrap'
import { CLI } from './CLI'
import { Completions } from './completions'
import { DebugInfo } from './DebugInfo'
import { Format } from './Format'
import { Generate } from './Generate'
import { Init } from './Init'
import { Mcp } from './mcp/MCP'
import { Platform } from './platform/_Platform'
import { Link as PostgresLink } from './postgres/link/Link'
import { PostgresCommand } from './postgres/PostgresCommand'
import { Status } from './Status'
import { Studio } from './Studio'
/*
  When running bin.ts with ts-node with DEBUG="*"
  This error shows and blocks the execution
  Quick hack is to comment the Studio import and usage to use the CLI without building it...
  prisma:cli Error: Cannot find module '@prisma/internals'
  prisma:cli Require stack:
  prisma:cli - /Users/j42/Dev/prisma-meow/node_modules/.pnpm/@prisma+studio-pcw@0.456.0/node_modules/@prisma/studio-pcw/dist/index.js
*/
// import { Studio } from './Studio'
import { SubCommand } from './SubCommand'
import { Telemetry } from './Telemetry'
import { redactCommandArray } from './utils/checkpoint'
import { getCliDistributionIdentity } from './utils/cli-distribution-identity'
import { loadOrInitializeCommandState } from './utils/commandState'
import { UserFacingError } from './utils/errors'
import { loadConfig } from './utils/loadConfig'
import { Validate } from './Validate'
import { Version } from './Version'

context.setGlobalContextManager(new AsyncLocalStorageContextManager())
trace.setGlobalTracerProvider(new BasicTracerProvider())

const debug = Debug('prisma:cli:bin')

const packageJson = require('../package.json')

const commandArray = process.argv.slice(2)

process.removeAllListeners('warning')

process.once('SIGINT', () => {
  process.exitCode = 130

  // no further downstream listeners for SIGINT, exit immediately with the code set above.
  if (process.listenerCount('SIGINT') === 0) {
    process.exit()
  }
  // otherwise, let the downstream listeners handle it.
})

// Parse CLI arguments
const args = arg(
  commandArray,
  {
    '--config': String,
  },
  false,
  true,
)

/**
 * Main function
 */
async function main(): Promise<number> {
  // create a new CLI with our subcommands

  const identity = getCliDistributionIdentity()

  const cli = CLI.new(
    {
      bootstrap: Bootstrap.new(identity),
      init: Init.new(identity),
      mcp: Mcp.new(identity),
      migrate: MigrateCommand.new(
        {
          dev: MigrateDev.new(identity),
          status: MigrateStatus.new(identity),
          resolve: MigrateResolve.new(identity),
          reset: MigrateReset.new(identity),
          deploy: MigrateDeploy.new(identity),
          diff: MigrateDiff.new(identity),
        },
        identity,
      ),
      db: DbCommand.new(
        {
          execute: DbExecute.new(identity),
          pull: DbPull.new(identity),
          push: DbPush.new(identity),
          // drop: DbDrop.new('prisma'),
          seed: DbSeed.new(identity),
        },
        identity,
      ),
      postgres: PostgresCommand.new(
        {
          link: PostgresLink.new(identity),
        },
        identity,
      ),
      generate: Generate.new(identity),
      version: Version.new(identity),
      validate: Validate.new(identity),
      format: Format.new(identity),
      telemetry: Telemetry.new(),
      debug: DebugInfo.new(identity),
      complete: Completions.new(identity),
      dev: new SubCommand('@prisma/cli-dev', identity),
      studio: Studio.new(identity),
      platform: Platform.$.new({ status: Status.new(identity) }, identity),
    },
    ['version', 'init', 'migrate', 'db', 'generate', 'validate', 'format', 'telemetry'],
    download,
    identity,
  )

  await loadOrInitializeCommandState().catch((err) => {
    debug(`Failed to initialize the command state: ${err}`)
  })

  const configFile = args['--config']
  const configDir = configFile ? path.resolve(configFile, '..') : process.cwd()

  const isCompleteCommand = !isError(args) && args._[0] === 'complete'

  const configEither = isCompleteCommand ? { config: defaultConfig(), diagnostics: [] } : await loadConfig(configFile)

  if (configEither instanceof HelpError) {
    console.error(configEither.message)
    return 1
  }

  const { config, diagnostics: configDiagnostics } = configEither

  // Diagnostics like informational logs and warnings are logged to stderr, to not interfere with structured output
  // in some of the commands consuming the Prisma config.
  // See: https://www.gnu.org/software/libc/manual/html_node/Standard-Streams.html
  const configDiagnosticFormatters: InjectFormatters = {
    // This fixes https://github.com/prisma/prisma/issues/27609.
    log: (data) => process.stderr.write(data + '\n'),
    warn: (data) => console.warn(`${yellow(bold('warn'))} ${data}`),
    dim: (data) => dim(data),

    // `terminal-link` is not easily installable in `@prisma/config` without introducing ESM/CJS incompatibility issues, or
    //  circular dependencies (requiring yet another `@prisma` package),
    link: (data) => link(data),
  }

  for (const configDiagnostic of configDiagnostics) {
    configDiagnostic.value(configDiagnosticFormatters)()
  }

  try {
    const startCliExec = performance.now()
    // Execute the command
    const result = await cli.parse(commandArray, config, configDir)
    const endCliExec = performance.now()
    const cliExecElapsedTime = endCliExec - startCliExec
    debug(`Execution time for executing "await cli.parse(commandArray)": ${cliExecElapsedTime} ms`)

    if (result instanceof Error) {
      if (result instanceof HelpError || result instanceof UserFacingError) {
        console.error(result.message)
      } else {
        console.error(result)
      }
      return 1
    }

    // Success
    console.log(result)

    return 0
  } catch (error) {
    if (isRustPanic(error)) {
      await handlePanic({
        error,
        cliVersion: packageJson.version,
        enginesVersion,
        command: redactCommandArray([...commandArray]).join(' '),
        getDatabaseVersionSafe: (args) => getDatabaseVersionSafe(args, config, configDir),
      })
    }
    throw error
  }
}

export function run(): void {
  main()
    .then((code) => {
      if (code !== 0) {
        process.exit(code)
      }
    })
    .catch((err) => {
      // Sindre's pkg p-map & co are using AggregateError, it is an iterator.
      if (typeof err[Symbol.iterator] === 'function') {
        for (const individualError of err) {
          handleIndividualError(individualError)
        }
      } else {
        handleIndividualError(err)
      }
    })
}

/**
 * Run our program
 */
if (eval('require.main === module')) {
  run()
}

function handleIndividualError(error: Error): void {
  if (Debug.enabled('prisma')) {
    console.error(bold(red('Error: ')) + error.stack)
  } else {
    console.error(bold(red('Error: ')) + error.message)
  }

  process.exit(1)
}

/**
 * Annotations for `pkg` so it bundles things correctly with yarn's hoisting
 * `node_modules/prisma/build/index.js` needs to get to:
 * `node_modules/@prisma/engines`
 */

// macOS
path.join(__dirname, '../../engines/schema-engine-darwin')
// Windows
path.join(__dirname, '../../engines/schema-engine-windows.exe')

// Debian openssl-1.0.x
path.join(__dirname, '../../engines/schema-engine-debian-openssl-1.0.x')
// Debian openssl-1.1.x
path.join(__dirname, '../../engines/schema-engine-debian-openssl-1.1.x')
// Debian openssl-3.0.x
path.join(__dirname, '../../engines/schema-engine-debian-openssl-3.0.x')

// Red Hat Enterprise Linux openssl-1.0.x
path.join(__dirname, '../../engines/schema-engine-rhel-openssl-1.0.x')
// Red Hat Enterprise Linux openssl-1.1.x
path.join(__dirname, '../../engines/schema-engine-rhel-openssl-1.1.x')
// Red Hat Enterprise Linux openssl-3.0.x
path.join(__dirname, '../../engines/schema-engine-rhel-openssl-3.0.x')
