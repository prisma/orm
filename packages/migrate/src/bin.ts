#!/usr/bin/env tsx

import path from 'node:path'

import { loadConfigFromFile } from '@prisma/config'
import Debug from '@prisma/debug'
import { enginesVersion } from '@prisma/engines-version'
import { arg, handlePanic, HelpError, isError } from '@prisma/internals'
import { bold, red } from 'kleur/colors'

import { version as packageVersion } from '../package.json'
import { CLI } from './CLI'
import { DbCommand } from './commands/DbCommand'
import { DbExecute } from './commands/DbExecute'
import { DbPull } from './commands/DbPull'
import { DbPush } from './commands/DbPush'
// import { DbDrop } from './commands/DbDrop'
import { DbSeed } from './commands/DbSeed'
import { MigrateCommand } from './commands/MigrateCommand'
import { MigrateDeploy } from './commands/MigrateDeploy'
import { MigrateDev } from './commands/MigrateDev'
import { MigrateDiff } from './commands/MigrateDiff'
import { MigrateReset } from './commands/MigrateReset'
import { MigrateResolve } from './commands/MigrateResolve'
import { MigrateStatus } from './commands/MigrateStatus'
import { getDatabaseVersionSafe } from './utils/getDatabaseVersionSafe'

process.on('uncaughtException', (e) => {
  console.log(e)
})
process.on('unhandledRejection', (e, promise) => {
  console.log(String(e), String(promise))
})
// Listen to Ctr + C and exit
process.once('SIGINT', () => {
  process.exit(130)
})

const commandArray = process.argv.slice(2)

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
  const cli = CLI.new({
    migrate: MigrateCommand.new(
      {
        dev: MigrateDev.new('prisma'),
        status: MigrateStatus.new('prisma'),
        resolve: MigrateResolve.new('prisma'),
        reset: MigrateReset.new('prisma'),
        deploy: MigrateDeploy.new('prisma'),
        diff: MigrateDiff.new('prisma'),
      },
      'prisma',
    ),
    db: DbCommand.new(
      {
        execute: DbExecute.new('prisma'),
        pull: DbPull.new('prisma'),
        push: DbPush.new('prisma'),
        // drop: DbDrop.new('prisma'),
        seed: DbSeed.new('prisma'),
      },
      'prisma',
    ),
  })

  const configFile = args['--config']
  const baseDir = configFile ? path.resolve(configFile, '..') : process.cwd()

  const { config, error } = await loadConfigFromFile({ configFile })
  if (error) {
    console.error(`Failed to load config file: ${error._tag}`)
    return 1
  }

  if (!config) {
    console.error('`prisma7.config.ts` not found')
    return 1
  }

  try {
    // Execute the command
    const result = await cli.parse(commandArray, config, baseDir)
    // Did it error?
    if (result instanceof HelpError) {
      console.error(result)
      // TODO: We could do like Bash (and other)
      // = return an exit status of 2 to indicate incorrect usage like invalid options or missing arguments.
      // https://tldp.org/LDP/abs/html/exitcodes.html
      return 1
    } else if (isError(result)) {
      console.error(result)
      return 1
    }

    // Success
    console.log(result)
    return 0
  } catch (error) {
    if (error.rustStack) {
      await handlePanic({
        error,
        cliVersion: packageVersion,
        enginesVersion,
        command: commandArray.join(' '),
        getDatabaseVersionSafe: (args) => getDatabaseVersionSafe(args, config, baseDir),
      })
    }
    throw error
  }
}

/**
 * Run our program
 */
main()
  .then((code) => {
    if (code !== 0) {
      process.exit(code)
    }
  })
  .catch((error) => {
    if (Debug.enabled('migrate')) {
      console.error(red(bold('Error: ')) + error.stack)
    } else {
      console.error(red(bold('Error: ')) + error.message)
    }
    process.exit(1)
  })
