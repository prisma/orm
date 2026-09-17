import type { PrismaConfigInternal } from '@prisma/config'
import type { Command, Commands } from '@prisma/internals'
import { arg, format, HelpError, isError, unknownCommand } from '@prisma/internals'
import { bold, dim, red } from 'kleur/colors'

function renderHelp(cliCommand: string): string {
  return format(`
Update the database schema with migrations

${bold('Usage')}

  ${dim('$')} ${cliCommand} migrate [command] [options]

${bold('Commands for development')}

         dev   Create a migration from changes in Prisma schema, apply it to the database
               trigger generators (e.g. Prisma Client)
       reset   Reset your database and apply all migrations, all data will be lost

${bold('Commands for production/staging')}

      deploy   Apply pending migrations to the database
      status   Check the status of your database migrations
     resolve   Resolve issues with database migrations, i.e. baseline, failed migration, hotfix

${bold('Command for any stage')}

        diff   Compare the database schema from two arbitrary sources

${bold('Options')}

  -h, --help   Display this help message
    --config   Custom path to your Prisma config file
    --schema   Custom path to your Prisma schema
  --no-hints   Hides the hint messages but still outputs errors and warnings

${bold('Examples')}

  Create a migration from changes in Prisma schema, apply it to the database, trigger generators (e.g. Prisma Client)
  ${dim('$')} ${cliCommand} migrate dev

  Reset your database and apply all migrations
  ${dim('$')} ${cliCommand} migrate reset

  Apply pending migrations to the database in production/staging
  ${dim('$')} ${cliCommand} migrate deploy

  Check the status of migrations in the production/staging database
  ${dim('$')} ${cliCommand} migrate status

  Specify a schema
  ${dim('$')} ${cliCommand} migrate status --schema=./schema.prisma

  Compare the database schema from two databases and render the diff as a SQL script
  ${dim('$')} ${cliCommand} migrate diff \
    --from-url "$DATABASE_URL" \
    --to-url "postgresql://login:password@localhost:5432/db" \
    --script
`)
}

export class MigrateCommand implements Command {
  public static new(cmds: Commands, cliCommand: string): MigrateCommand {
    return new MigrateCommand(cmds, cliCommand)
  }

  private constructor(
    private readonly cmds: Commands,
    private readonly cliCommand: string,
  ) {}

  public async parse(argv: string[], config: PrismaConfigInternal, baseDir: string): Promise<string | Error> {
    const args = arg(argv, {
      '--help': Boolean,
      '-h': '--help',
      '--config': String,
      '--preview-feature': Boolean,
      '--no-hints': Boolean,
      '--telemetry-information': String,
    })

    if (isError(args)) {
      return this.help(args.message)
    }

    if (args._.length === 0 || args['--help']) {
      return this.help()
    }

    const commandName = args._[0]
    const cmd = this.cmds[commandName]
    if (cmd) {
      let argsForCmd: string[]
      if (commandName === 'diff') {
        argsForCmd = args['--preview-feature'] ? [...args._.slice(1), `--preview-feature`] : args._.slice(1)
      } else {
        const filteredArgs = args._.filter((item) => item !== '--preview-feature')
        argsForCmd = filteredArgs.slice(1)
      }

      if (args['--no-hints'] && (commandName === 'deploy' || commandName === 'status')) {
        argsForCmd.push('--no-hints')
      }

      return cmd.parse(argsForCmd, config, baseDir)
    }

    return unknownCommand(renderHelp(this.cliCommand), commandName)
  }

  public help(error?: string): string | HelpError {
    const help = renderHelp(this.cliCommand)

    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${help}`)
    }
    return help
  }
}
