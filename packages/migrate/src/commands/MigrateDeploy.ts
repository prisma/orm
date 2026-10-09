import type { PrismaConfigInternal } from '@prisma/config'
import Debug from '@prisma/debug'
import {
  arg,
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

import { Migrate } from '../Migrate'
import { ensureDatabaseExists, parseDatasourceInfo } from '../utils/ensureDatabaseExists'
import { printDatasource } from '../utils/printDatasource'
import { printFilesFromMigrationIds } from '../utils/printFiles'

const debug = Debug('prisma:migrate:deploy')

function renderHelp(cliCommand: string): string {
  return format(`
Apply pending migrations to update the database schema in production/staging

${bold('Usage')}

  ${dim('$')} ${cliCommand} migrate deploy [options]

  The datasource URL configuration is read from the Prisma config file (e.g., ${italic('prisma7.config.ts')}).

${bold('Options')}

  -h, --help   Display this help message
    --config   Custom path to your Prisma config file
    --schema   Custom path to your Prisma schema
  --no-hints   Hides the hint messages but still outputs errors and warnings

${bold('Examples')}

  Deploy your pending migrations to your production/staging database
  ${dim('$')} ${cliCommand} migrate deploy

  Specify a schema
  ${dim('$')} ${cliCommand} migrate deploy --schema=./schema.prisma

`)
}

export class MigrateDeploy implements Command {
  public static new(cliCommand: string): MigrateDeploy {
    return new MigrateDeploy(cliCommand)
  }

  private constructor(private readonly cliCommand: string) {}

  public async parse(argv: string[], config: PrismaConfigInternal, baseDir: string): Promise<string | Error> {
    const args = arg(
      argv,
      {
        '--help': Boolean,
        '-h': '--help',
        '--schema': String,
        '--config': String,
        '--no-hints': Boolean,
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

    const hideHints = args['--no-hints'] ?? false

    const schemaContext = await loadSchemaContext({
      schemaPath: createSchemaPathInput({
        schemaPathFromArgs: args['--schema'],
        schemaPathFromConfig: config.schema,
        baseDir,
      }),
      printLoadMessage: !hideHints,
    })
    const { migrationsDirPath } = inferDirectoryConfig(schemaContext, config)

    const cmd = `${this.cliCommand} migrate deploy`
    const validatedConfig = validatePrismaConfigWithDatasource({ config, command: cmd })

    checkUnsupportedDataProxy({ command: cmd, validatedConfig })

    if (!hideHints) {
      printDatasource({ datasourceInfo: parseDatasourceInfo(schemaContext.primaryDatasource, validatedConfig) })
    }

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

    try {
      // Automatically create the database if it doesn't exist
      const successMessage = await ensureDatabaseExists(
        baseDir,
        getSchemaDatasourceProvider(schemaContext),
        validatedConfig,
      )
      if (successMessage) {
        process.stdout.write('\n' + successMessage + '\n')
      }
    } catch (e) {
      process.stdout.write('\n') // empty line
      throw e
    }

    const listMigrationDirectoriesResult = await migrate.listMigrationDirectories()
    debug({ listMigrationDirectoriesResult })

    process.stdout.write('\n') // empty line
    if (listMigrationDirectoriesResult.migrations.length > 0) {
      const migrations = listMigrationDirectoriesResult.migrations
      process.stdout.write(
        `${migrations.length} migration${migrations.length > 1 ? 's' : ''} found in prisma/migrations\n`,
      )
    } else {
      process.stdout.write(`No migration found in prisma/migrations\n`)
    }

    let migrationIds: string[]
    try {
      process.stdout.write('\n') // empty line
      const { appliedMigrationNames } = await migrate.applyMigrations()
      migrationIds = appliedMigrationNames
    } finally {
      // Stop engine
      await migrate.stop()
    }

    process.stdout.write('\n') // empty line
    if (migrationIds.length === 0) {
      return green(`No pending migrations to apply.`)
    } else {
      return `The following migration(s) have been applied:\n\n${printFilesFromMigrationIds(
        'migrations',
        migrationIds,
        {
          'migration.sql': '',
        },
      )}

${green('All migrations have been successfully applied.')}`
    }
  }

  public help(error?: string): string | HelpError {
    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${renderHelp(this.cliCommand)}`)
    }
    return renderHelp(this.cliCommand)
  }
}
