import type { PrismaConfigInternal } from '@prisma/config'
import Debug from '@prisma/debug'
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
  MigrateTypes,
  validatePrismaConfigWithDatasource,
} from '@prisma/internals'
import { bold, dim, green, italic, red } from 'kleur/colors'

import { Migrate } from '../Migrate'
import type { EngineResults } from '../types'
import { ensureCanConnectToDatabase, parseDatasourceInfo } from '../utils/ensureDatabaseExists'
import { printDatasource } from '../utils/printDatasource'

const debug = Debug('prisma:migrate:status')

function renderHelp(cliCommand: string): string {
  return format(`
Check the status of your database migrations

  ${bold('Usage')}

    ${dim('$')} ${cliCommand} migrate status [options]

    The datasource URL configuration is read from the Prisma config file (e.g., ${italic('prisma7.config.ts')}).

  ${bold('Options')}

  -h, --help   Display this help message
    --config   Custom path to your Prisma config file
    --schema   Custom path to your Prisma schema

  ${bold('Examples')}

  Check the status of your database migrations
  ${dim('$')} ${cliCommand} migrate status

  Specify a schema
  ${dim('$')} ${cliCommand} migrate status --schema=./schema.prisma
`)
}

export class MigrateStatus implements Command {
  public static new(cliCommand: string): MigrateStatus {
    return new MigrateStatus(cliCommand)
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

    const cmd = `${this.cliCommand} migrate status`
    const validatedConfig = validatePrismaConfigWithDatasource({ config, command: cmd })

    checkUnsupportedDataProxy({ command: cmd, validatedConfig })

    printDatasource({ datasourceInfo: parseDatasourceInfo(schemaContext.primaryDatasource, validatedConfig) })

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

    await ensureCanConnectToDatabase(baseDir, validatedConfig)

    // This is a *read-only* command (modulo shadow database).
    // - ↩️ **RPC**: ****`diagnoseMigrationHistory`, then four cases based on the response.
    //     4. Otherwise, there is no problem migrate is aware of. We could still display:
    //         - Modified since applied only relevant when using dev, they are ignored for deploy
    //         - Pending migrations (those in the migrations folder that haven't been applied yet)
    //         - If there are no pending migrations, tell the user everything looks OK and up to date.

    let diagnoseResult: EngineResults.DiagnoseMigrationHistoryOutput
    let listMigrationDirectoriesResult: EngineResults.ListMigrationDirectoriesOutput

    try {
      diagnoseResult = await migrate.diagnoseMigrationHistory({
        optInToShadowDatabase: false,
      })
      debug({ diagnoseResult: JSON.stringify(diagnoseResult, null, 2) })

      listMigrationDirectoriesResult = await migrate.listMigrationDirectories()
      debug({ listMigrationDirectoriesResult })
    } finally {
      await migrate.stop()
    }

    process.stdout.write('\n') // empty line

    if (listMigrationDirectoriesResult.migrations.length > 0) {
      const migrations = listMigrationDirectoriesResult.migrations
      process.stdout.write(
        `${migrations.length} migration${migrations.length > 1 ? 's' : ''} found in prisma/migrations\n`,
      )
    } else {
      process.stdout.write(`No migration found in prisma/migrations\n`)
    }

    let unappliedMigrations: string[] = []
    if (diagnoseResult.history?.diagnostic === 'databaseIsBehind') {
      unappliedMigrations = diagnoseResult.history.unappliedMigrationNames
      process.stdout.write(
        `Following migration${unappliedMigrations.length > 1 ? 's' : ''} have not yet been applied:
${unappliedMigrations.join('\n')}

To apply migrations in development run ${bold(green(getCommandWithExecutor(`${this.cliCommand} migrate dev`)))}.
To apply migrations in production run ${bold(green(getCommandWithExecutor(`${this.cliCommand} migrate deploy`)))}.\n`,
      )
      // Exit 1 to signal that the status is not in sync
      process.exit(1)
    } else if (diagnoseResult.history?.diagnostic === 'historiesDiverge') {
      console.error(`Your local migration history and the migrations table from your database are different:

The last common migration is: ${diagnoseResult.history.lastCommonMigrationName}

The migration${diagnoseResult.history.unappliedMigrationNames.length > 1 ? 's' : ''} have not yet been applied:
${diagnoseResult.history.unappliedMigrationNames.join('\n')}

The migration${
        diagnoseResult.history.unpersistedMigrationNames.length > 1 ? 's' : ''
      } from the database are not found locally in prisma/migrations:
${diagnoseResult.history.unpersistedMigrationNames.join('\n')}`)
      // Exit 1 to signal that the status is not in sync
      process.exit(1)
    }

    if (!diagnoseResult.hasMigrationsTable) {
      //         - This is the **baselining** case.
      //         - Look at the migrations in the migrations folder
      //             - There is no local migration
      //                 - ...and there is drift: the user is coming from db push or another migration tool.
      //                 - Guide the user to an init flow with introspect + SQL schema dump (optionally)
      //             - There are local migrations
      //                 - ↩️ **RPC** `listMigrationDirectories` ****Take the first (=oldest) migration.
      //                 - Suggest calling `prisma migrate resolve --applied <migration-name>`

      if (listMigrationDirectoriesResult.migrations.length === 0) {
        console.error(`The current database is not managed by Prisma Migrate.

Read more about how to baseline an existing production database:
${link('https://pris.ly/d/migrate-baseline')}`)
        // Exit 1 to signal that the status is not in sync
        process.exit(1)
      } else {
        const migrationId = listMigrationDirectoriesResult.migrations.shift() as string
        console.error(`The current database is not managed by Prisma Migrate.

If you want to keep the current database structure and data and create new migrations, baseline this database with the migration "${migrationId}":
${bold(green(getCommandWithExecutor(`${this.cliCommand} migrate resolve --applied "${migrationId}"`)))}

Read more about how to baseline an existing production database:
https://pris.ly/d/migrate-baseline`)
        // Exit 1 to signal that the status is not in sync
        process.exit(1)
      }
    } else if (diagnoseResult.failedMigrationNames.length > 0) {
      //         - This is the **recovering from a partially failed migration** case.
      //         - Inform the user that they can "close the case" and mark the failed migration as fixed by calling `prisma migrate resolve`.
      //             - `prisma migrate resolve --rolled-back <migration-name>` if the migration was rolled back
      //             - `prisma migrate resolve --applied <migration-name>` if the migration was rolled forward (and completed successfully)
      const failedMigrations = diagnoseResult.failedMigrationNames

      console.error(
        `Following migration${failedMigrations.length > 1 ? 's' : ''} have failed:
${failedMigrations.join('\n')}

During development if the failed migration(s) have not been deployed to a production database you can then fix the migration(s) and run ${bold(
          green(getCommandWithExecutor(`${this.cliCommand} migrate dev`)),
        )}.\n`,
      )

      console.error(`The failed migration(s) can be marked as rolled back or applied:

- If you rolled back the migration(s) manually:
${bold(green(getCommandWithExecutor(`${this.cliCommand} migrate resolve --rolled-back "${failedMigrations[0]}"`)))}

- If you fixed the database manually (hotfix):
${bold(green(getCommandWithExecutor(`${this.cliCommand} migrate resolve --applied "${failedMigrations[0]}"`)))}

Read more about how to resolve migration issues in a production database:
${link('https://pris.ly/d/migrate-resolve')}`)

      // Exit 1 to signal that the status is not in sync
      process.exit(1)
    } else {
      process.stdout.write('\n') // empty line
      if (unappliedMigrations.length === 0) {
        // Exit 0 to signal that the status is in sync
        return `Database schema is up to date!`
      }
    }

    // Only needed for the return type to match
    return ''
  }

  public help(error?: string): string | HelpError {
    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${renderHelp(this.cliCommand)}`)
    }
    return renderHelp(this.cliCommand)
  }
}
