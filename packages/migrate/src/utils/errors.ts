import { getCommandWithExecutor, link, setClassName } from '@prisma/internals'
import { bold, green } from 'kleur/colors'

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
  }
}

setClassName(ConfigValidationError, 'ConfigValidationError')
export class NoSchemaFoundError extends Error {
  constructor() {
    super(
      `Could not find a ${bold(
        'schema.prisma',
      )} file that is required for this command.\nYou can either provide it with ${green(
        '--schema',
      )}, set its path in the \`schema\` property in your Prisma Config file, or put it into the default location ${green(
        './prisma/schema.prisma',
      )} ${link('https://pris.ly/d/prisma-schema-location')}`,
    )
  }
}
setClassName(NoSchemaFoundError, 'NoSchemaFoundError')

export class DbPushIgnoreWarningsWithFlagError extends Error {
  constructor(cliCommand: string) {
    super(
      `Use the --accept-data-loss flag to ignore the data loss warnings like ${bold(
        green(getCommandWithExecutor(`${cliCommand} db push --accept-data-loss`)),
      )}`,
    )
  }
}
setClassName(DbPushIgnoreWarningsWithFlagError, 'DbPushIgnoreWarningsWithFlagError')

export class MigrateNeedsForceError extends Error {
  constructor(subcommand: string, cliCommand: string) {
    super(
      `Use the --force flag to use the ${subcommand} command in an unattended environment like ${bold(
        green(getCommandWithExecutor(`${cliCommand} migrate ${subcommand} --force`)),
      )}`,
    )
  }
}
setClassName(MigrateNeedsForceError, 'MigrateNeedsForceError')

export class MigrateResetEnvNonInteractiveError extends Error {
  constructor() {
    super(
      `Prisma Migrate has detected that the environment is non-interactive. It is recommended to run this command in an interactive environment.

Use ${bold(green(`--force`))} to run this command without user interaction.
See ${link('https://pris.ly/d/migrate-reset')}`,
    )
  }
}
setClassName(MigrateResetEnvNonInteractiveError, 'MigrateResetEnvNonInteractiveError')

export class MigrateDevEnvNonInteractiveError extends Error {
  constructor(cliCommand: string) {
    super(
      `Prisma Migrate has detected that the environment is non-interactive, which is not supported.

\`${cliCommand} migrate dev\` is an interactive command designed to create new migrations and evolve the database in development.
To apply existing migrations in deployments, use ${bold(green(getCommandWithExecutor(`${cliCommand} migrate deploy`)))}.
See ${link('https://pris.ly/d/migrate-deploy')}`,
    )
  }
}
setClassName(MigrateDevEnvNonInteractiveError, 'MigrateDevEnvNonInteractiveError')

export class DbDropNeedsForceError extends Error {
  constructor(subcommand: string, cliCommand: string) {
    super(
      `Use the --force flag to use the ${subcommand} command in an unattended environment like ${bold(
        green(getCommandWithExecutor(`${cliCommand} db ${subcommand} --force --preview-feature`)),
      )}`,
    )
  }
}
setClassName(DbDropNeedsForceError, 'DbDropNeedsForceError')
