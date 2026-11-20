import type { PrismaConfigInternal } from '@prisma/config'
import {
  arg,
  canPrompt,
  checkUnsupportedDataProxy,
  Command,
  createSchemaPathInput,
  format,
  getSchemaDatasourceProvider,
  HelpError,
  inferDirectoryConfig,
  isError,
  loadSchemaContext,
  MigrateTypes,
  validatePrismaConfigWithDatasource,
} from '@prisma/internals'
import { bold, dim, green, italic, red } from 'kleur/colors'
import prompt from 'prompts'

import { Migrate } from '../Migrate'
import { aiAgentConfirmationCheckpoint } from '../utils/ai-safety'
import { ensureDatabaseExists, parseDatasourceInfo } from '../utils/ensureDatabaseExists'
import { MigrateResetEnvNonInteractiveError } from '../utils/errors'
import { printDatasource } from '../utils/printDatasource'
import { printFilesFromMigrationIds } from '../utils/printFiles'

function renderHelp(cliCommand: string): string {
  return format(`
Reset your database and apply all migrations, all data will be lost

${bold('Usage')}

  ${dim('$')} ${cliCommand} migrate reset [options]

  The datasource URL configuration is read from the Prisma config file (e.g., ${italic('prisma7.config.ts')}).

${bold('Options')}

       -h, --help   Display this help message
         --config   Custom path to your Prisma config file
         --schema   Custom path to your Prisma schema
      -f, --force   Skip the confirmation prompt

${bold('Examples')}

  Reset your database and apply all migrations, all data will be lost
  ${dim('$')} ${cliCommand} migrate reset

  Specify a schema
  ${dim('$')} ${cliCommand} migrate reset --schema=./schema.prisma

  Use --force to skip the confirmation prompt
  ${dim('$')} ${cliCommand} migrate reset --force
  `)
}

export class MigrateReset implements Command {
  public static new(cliCommand: string): MigrateReset {
    return new MigrateReset(cliCommand)
  }

  private constructor(private readonly cliCommand: string) {}

  public async parse(argv: string[], config: PrismaConfigInternal, baseDir: string): Promise<string | Error> {
    const args = arg(argv, {
      '--help': Boolean,
      '-h': '--help',
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

    const schemaContext = await loadSchemaContext({
      schemaPath: createSchemaPathInput({
        schemaPathFromArgs: args['--schema'],
        schemaPathFromConfig: config.schema,
        baseDir,
      }),
    })

    const cmd = `${this.cliCommand} migrate reset`
    const validatedConfig = validatePrismaConfigWithDatasource({ config, command: cmd })

    checkUnsupportedDataProxy({ command: cmd, validatedConfig })

    const { migrationsDirPath } = inferDirectoryConfig(schemaContext, config)
    const datasourceInfo = parseDatasourceInfo(schemaContext.primaryDatasource, validatedConfig)

    printDatasource({ datasourceInfo })

    // TODO: check why the output and error handling here is different than in `MigrateDeploy`.
    // Automatically create the database if it doesn't exist
    const successMessage = await ensureDatabaseExists(
      baseDir,
      getSchemaDatasourceProvider(schemaContext),
      validatedConfig,
    )
    if (successMessage) {
      process.stdout.write('\n' + successMessage + '\n')
    }

    process.stdout.write('\n')
    if (!args['--force']) {
      if (!canPrompt()) {
        throw new MigrateResetEnvNonInteractiveError()
      }

      const confirmation = await prompt({
        type: 'confirm',
        name: 'value',
        message: `Are you sure you want to reset your database? ${red('All data will be lost')}.`,
      })

      process.stdout.write('\n') // empty line

      if (!confirmation.value) {
        process.stdout.write('Reset cancelled.\n')
        // Return SIGINT exit code to signal that the process was cancelled
        process.exit(130)
      }
    }

    aiAgentConfirmationCheckpoint()

    const schemaFilter: MigrateTypes.SchemaFilter = {
      externalTables: config.tables?.external ?? [],
      externalEnums: config.enums?.external ?? [],
    }

    const migrate = await Migrate.setup({
      schemaEngineConfig: config,
      baseDir,
      migrationsDirPath,
      schemaContext,
      schemaFilter,
      extensions: config['extensions'],
    })

    let migrationIds: string[]
    try {
      await migrate.reset()

      const { appliedMigrationNames } = await migrate.applyMigrations()
      migrationIds = appliedMigrationNames
    } finally {
      // Stop engine
      await migrate.stop()
    }

    if (migrationIds.length === 0) {
      process.stdout.write(`${green('Database reset successful\n')}\n`)
    } else {
      process.stdout.write('\n') // empty line
      process.stdout.write(
        `${green('Database reset successful')}

The following migration(s) have been applied:\n\n${printFilesFromMigrationIds('migrations', migrationIds, {
          'migration.sql': '',
        })}\n`,
      )
    }

    return ``
  }

  public help(error?: string): string | HelpError {
    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${renderHelp(this.cliCommand)}`)
    }
    return renderHelp(this.cliCommand)
  }
}
