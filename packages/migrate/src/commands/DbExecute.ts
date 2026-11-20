import streamConsumer from 'node:stream/consumers'

import type { PrismaConfigInternal } from '@prisma/config'
import {
  arg,
  checkUnsupportedDataProxy,
  Command,
  format,
  getCommandWithExecutor,
  HelpError,
  isError,
  validatePrismaConfigWithDatasource,
} from '@prisma/internals'
import fs from 'fs'
import { bold, dim, green, italic } from 'kleur/colors'
import path from 'path'

import { Migrate } from '../Migrate'
import type { EngineArgs } from '../types'

function renderHelpOptions(cliCommand: string): string {
  return format(
    `${bold('Usage')}

  ${dim('$')} ${cliCommand} db execute [options]

  The datasource URL configuration is read from the Prisma config file (e.g., ${italic('prisma7.config.ts')}).

${bold('Options')}

-h, --help            Display this help message
--config              Custom path to your Prisma config file

${italic('Script input, only 1 must be provided:')}
--file                Path to a file. The content will be sent as the script to be executed

${bold('Flags')}

--stdin              Use the terminal standard input as the script to be executed`,
  )
}

function renderHelp(cliCommand: string): string {
  return format(`
${process.platform === 'win32' ? '' : '📝 '}Execute native commands to your database

This command takes as input a datasource defined in ${italic('prisma7.config.ts')} and a script, using ${green(
    `--stdin`,
  )} or ${green(`--file`)}.
The script input parameters are mutually exclusive, only 1 must be provided.

The output of the command is connector-specific, and is not meant for returning data, but only to report success or failure.

On SQL databases, this command takes as input a SQL script.
The whole script will be sent as a single command to the database.

${italic(`This command is currently not supported on MongoDB.`)}

${renderHelpOptions(cliCommand)}
${bold('Examples')}

  Execute the content of a SQL script file using the datasource configured in prisma7.config.ts
  ${dim('$')} ${cliCommand} db execute --file ./script.sql

  Execute the SQL script from stdin using the configured datasource
  ${dim('$')} echo 'TRUNCATE TABLE dev;' | \
    ${cliCommand} db execute \
    --stdin
`)
}

export class DbExecute implements Command {
  public static new(cliCommand: string): DbExecute {
    return new DbExecute(cliCommand)
  }

  private constructor(private readonly cliCommand: string) {}

  public async parse(argv: string[], config: PrismaConfigInternal, baseDir: string): Promise<string | Error> {
    const args = arg(
      argv,
      {
        '--help': Boolean,
        '-h': '--help',
        '--config': String,
        '--stdin': Boolean,
        '--file': String,
        '--telemetry-information': String,
      },
      false,
    )

    if (isError(args)) {
      return this.help(args.message)
    }

    if (args['--help']) {
      return this.help()
    }

    const cmd = `${this.cliCommand} db execute`
    const validatedConfig = validatePrismaConfigWithDatasource({ config, command: cmd })

    if (args['--stdin'] && args['--file']) {
      throw new Error(
        `--stdin and --file cannot be used at the same time. Only 1 must be provided.
See \`${green(getCommandWithExecutor(`${this.cliCommand} db execute -h`))}\``,
      )
    } else if (!args['--stdin'] && !args['--file']) {
      throw new Error(
        `Either --stdin or --file must be provided.
See \`${green(getCommandWithExecutor(`${this.cliCommand} db execute -h`))}\``,
      )
    }

    let script = ''
    if (args['--file']) {
      try {
        script = fs.readFileSync(path.resolve(args['--file']), 'utf-8')
      } catch (e) {
        if (e.code === 'ENOENT') {
          throw new Error(`Provided --file at ${args['--file']} doesn't exist.`)
        } else {
          console.error(`An error occurred while reading the provided --file at ${args['--file']}`)
          throw e
        }
      }
    }

    if (args['--stdin']) {
      script = await streamConsumer.text(process.stdin)
    }

    checkUnsupportedDataProxy({ command: cmd, validatedConfig })

    const datasourceType: EngineArgs.DbExecuteDatasourceType = {
      tag: 'url',
      url: validatedConfig.datasource.url,
    }

    const migrate = await Migrate.setup({
      schemaEngineConfig: config,
      extensions: config['extensions'],
      baseDir,
    })

    try {
      await migrate.engine.dbExecute({
        script,
        datasourceType,
      })
    } finally {
      await migrate.stop()
    }

    return `Script executed successfully.`
  }

  public help(error?: string): string | HelpError {
    if (error) {
      throw new HelpError(`\n${error}\n\n${renderHelpOptions(this.cliCommand)}`)
    }
    return renderHelp(this.cliCommand)
  }
}
