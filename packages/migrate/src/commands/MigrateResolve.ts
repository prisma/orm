import type { PrismaConfigInternal } from '@prisma/config'
import {
  arg,
  checkUnsupportedDataProxy,
  Command,
  createSchemaPathInput,
  format,
  getCommandWithExecutor,
  HelpError,
  inferDirectoryConfig,
  isError,
  link,
  loadSchemaContext,
  validatePrismaConfigWithDatasource,
} from '@prisma/internals'
import { bold, dim, green, italic, red } from 'kleur/colors'

import { Migrate } from '../Migrate'
import { ensureCanConnectToDatabase, parseDatasourceInfo } from '../utils/ensureDatabaseExists'
import { printDatasource } from '../utils/printDatasource'

function renderHelp(cliCommand: string): string {
  return format(`
Resolve issues with database migrations in deployment databases:
- recover from failed migrations
- baseline databases when starting to use Prisma Migrate on existing databases
- reconcile hotfixes done manually on databases with your migration history

Run "${cliCommand} migrate status" to identify if you need to use resolve.

Read more about resolving migration history issues: ${link('https://pris.ly/d/migrate-resolve')}

${bold('Usage')}

  ${dim('$')} ${cliCommand} migrate resolve [options]

  The datasource URL configuration is read from the Prisma config file (e.g., ${italic('prisma7.config.ts')}).

${bold('Options')}

    -h, --help   Display this help message
      --config   Custom path to your Prisma config file
      --schema   Custom path to your Prisma schema
     --applied   Record a specific migration as applied
 --rolled-back   Record a specific migration as rolled back

${bold('Examples')}

  Update migrations table, recording a specific migration as applied
  ${dim('$')} ${cliCommand} migrate resolve --applied 20201231000000_add_users_table

  Update migrations table, recording a specific migration as rolled back
  ${dim('$')} ${cliCommand} migrate resolve --rolled-back 20201231000000_add_users_table

  Specify a schema
  ${dim('$')} ${cliCommand} migrate resolve --rolled-back 20201231000000_add_users_table --schema=./schema.prisma
`)
}

export class MigrateResolve implements Command {
  public static new(cliCommand: string): MigrateResolve {
    return new MigrateResolve(cliCommand)
  }

  private constructor(private readonly cliCommand: string) {}

  public async parse(argv: string[], config: PrismaConfigInternal, baseDir: string): Promise<string | Error> {
    const args = arg(
      argv,
      {
        '--help': Boolean,
        '-h': '--help',
        '--applied': String,
        '--rolled-back': String,
        '--schema': String,
        '--config': String,
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

    const schemaContext = await loadSchemaContext({
      schemaPath: createSchemaPathInput({
        schemaPathFromArgs: args['--schema'],
        schemaPathFromConfig: config.schema,
        baseDir,
      }),
    })
    const { migrationsDirPath } = inferDirectoryConfig(schemaContext, config)

    const cmd = `${this.cliCommand} migrate resolve`
    const validatedConfig = validatePrismaConfigWithDatasource({ config, command: cmd })

    checkUnsupportedDataProxy({ command: cmd, validatedConfig })

    printDatasource({ datasourceInfo: parseDatasourceInfo(schemaContext.primaryDatasource, validatedConfig) })

    if (!args['--applied'] && !args['--rolled-back']) {
      throw new Error(
        `--applied or --rolled-back must be part of the command like:
${bold(green(getCommandWithExecutor(`${this.cliCommand} migrate resolve --applied 20201231000000_example`)))}
${bold(green(getCommandWithExecutor(`${this.cliCommand} migrate resolve --rolled-back 20201231000000_example`)))}`,
      )
    } else if (args['--applied'] && args['--rolled-back']) {
      throw new Error('Pass either --applied or --rolled-back, not both.')
    }

    if (args['--applied']) {
      if (typeof args['--applied'] !== 'string' || args['--applied'].length === 0) {
        throw new Error(
          `--applied value must be a string like ${bold(
            green(getCommandWithExecutor(`${this.cliCommand} migrate resolve --applied 20201231000000_example`)),
          )}`,
        )
      }

      await ensureCanConnectToDatabase(baseDir, validatedConfig)

      const migrate = await Migrate.setup({
        schemaEngineConfig: config,
        baseDir,
        migrationsDirPath,
        schemaContext,
        extensions: config['extensions'],
      })

      try {
        await migrate.markMigrationApplied({
          migrationId: args['--applied'],
        })
      } finally {
        await migrate.stop()
      }

      process.stdout.write(`\nMigration ${args['--applied']} marked as applied.\n`)
      return ``
    }

    if (typeof args['--rolled-back'] !== 'string' || args['--rolled-back'].length === 0) {
      throw new Error(
        `--rolled-back value must be a string like ${bold(
          green(getCommandWithExecutor(`${this.cliCommand} migrate resolve --rolled-back 20201231000000_example`)),
        )}`,
      )
    }

    await ensureCanConnectToDatabase(baseDir, validatedConfig)

    const migrate = await Migrate.setup({
      schemaEngineConfig: config,
      baseDir,
      migrationsDirPath,
      schemaContext,
      extensions: config['extensions'],
    })

    try {
      await migrate.markMigrationRolledBack({
        migrationId: args['--rolled-back'],
      })
    } finally {
      await migrate.stop()
    }

    process.stdout.write(`\nMigration ${args['--rolled-back']} marked as rolled back.\n`)
    return ``
  }

  public help(error?: string): string | HelpError {
    const help = renderHelp(this.cliCommand)

    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${help}`)
    }
    return help
  }
}
