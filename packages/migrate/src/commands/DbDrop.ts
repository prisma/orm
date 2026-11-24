import type { PrismaConfigInternal } from '@prisma/config'
import {
  arg,
  canPrompt,
  checkUnsupportedDataProxy,
  Command,
  createSchemaPathInput,
  dropDatabase,
  format,
  HelpError,
  isError,
  link,
  loadSchemaContext,
  validatePrismaConfigWithDatasource,
} from '@prisma/internals'
import { bold, dim, italic, red, yellow } from 'kleur/colors'
import prompt from 'prompts'

import { aiAgentConfirmationCheckpoint } from '../utils/ai-safety'
import { parseDatasourceInfo } from '../utils/ensureDatabaseExists'
import { DbDropNeedsForceError } from '../utils/errors'
import { PreviewFlagError } from '../utils/flagErrors'
import { printDatasource } from '../utils/printDatasource'

function renderHelp(cliCommand: string): string {
  return format(`
${process.platform === 'win32' ? '' : '💣  '}Drop the database

${bold(yellow('WARNING'))} ${bold(
    `Prisma db drop is currently in Preview (${link('https://pris.ly/d/preview')}).
There may be bugs and it's not recommended to use it in production environments.`,
  )}
${dim('When using any of the subcommands below you need to explicitly opt-in via the --preview-feature flag.')}

${bold('Usage')}

  ${dim('$')} ${cliCommand} db drop [options] --preview-feature

  The datasource URL configuration is read from the Prisma config file (e.g., ${italic('prisma7.config.ts')}).

${bold('Options')}

   -h, --help   Display this help message
     --config   Custom path to your Prisma config file
     --schema   Custom path to your Prisma schema
  -f, --force   Skip the confirmation prompt

${bold('Examples')}

  Drop the database
  ${dim('$')} ${cliCommand} db drop --preview-feature

  Specify a schema
  ${dim('$')} ${cliCommand} db drop --preview-feature --schema=./schema.prisma

  Use --force to skip the confirmation prompt
  ${dim('$')} ${cliCommand} db drop --preview-feature --force
`)
}

export class DbDrop implements Command {
  public static new(cliCommand: string): DbDrop {
    return new DbDrop(cliCommand)
  }

  private constructor(private readonly cliCommand: string) {}

  public async parse(argv: string[], config: PrismaConfigInternal, baseDir: string): Promise<string | Error> {
    const args = arg(argv, {
      '--help': Boolean,
      '-h': '--help',
      '--preview-feature': Boolean,
      '--force': Boolean,
      '-f': '--force',
      '--schema': String,
      '--config': String,
      '--telemetry-information': String,
    })

    if (isError(args)) {
      return this.help(args.message)
    }

    if (args['--help']) {
      return this.help()
    }

    if (!args['--preview-feature']) {
      throw new PreviewFlagError()
    }

    const schemaContext = await loadSchemaContext({
      schemaPath: createSchemaPathInput({
        schemaPathFromArgs: args['--schema'],
        schemaPathFromConfig: config.schema,
        baseDir,
      }),
    })

    const cmd = `${this.cliCommand} db drop`
    const validatedConfig = validatePrismaConfigWithDatasource({ config, command: cmd })

    checkUnsupportedDataProxy({ command: cmd, validatedConfig })

    const datasourceInfo = parseDatasourceInfo(schemaContext.primaryDatasource, validatedConfig)
    printDatasource({ datasourceInfo })

    process.stdout.write('\n') // empty line

    if (!args['--force']) {
      if (!canPrompt()) {
        throw new DbDropNeedsForceError('drop', this.cliCommand)
      }

      const confirmation = await prompt({
        type: 'text',
        name: 'value',
        message: `Enter the ${datasourceInfo.prettyProvider} database name "${
          datasourceInfo.dbName
        }" to drop it.\nLocation: "${datasourceInfo.dbLocation}".\n${red('All data will be lost')}.`,
      })
      process.stdout.write('\n') // empty line

      if (!confirmation.value) {
        process.stdout.write('Drop cancelled.\n')
        // Return SIGINT exit code to signal that the process was cancelled.
        process.exit(130)
      } else if (confirmation.value !== datasourceInfo.dbName) {
        throw Error(`The database name entered "${confirmation.value}" doesn't match "${datasourceInfo.dbName}".`)
      }
    }

    aiAgentConfirmationCheckpoint()

    if (datasourceInfo.url === undefined) {
      throw new Error('Datasource URL is undefined')
    }

    if (await dropDatabase(datasourceInfo.url, baseDir)) {
      return `${process.platform === 'win32' ? '' : '🚀  '}The ${datasourceInfo.prettyProvider} database "${
        datasourceInfo.dbName
      }" from "${datasourceInfo.dbLocation}" was successfully dropped.\n`
    } else {
      return ''
    }
  }

  public help(error?: string): string | HelpError {
    const help = renderHelp(this.cliCommand)

    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${help}`)
    }
    return help
  }
}
