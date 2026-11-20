import type { PrismaConfigInternal } from '@prisma/config'
import type { Command, Commands } from '@prisma/internals'
import { arg, format, HelpError, isError, unknownCommand } from '@prisma/internals'
import { bold, dim, red } from 'kleur/colors'

function renderHelp(cliCommand: string): string {
  return format(`
${process.platform === 'win32' ? '' : '🏋️  '}Manage your database schema and lifecycle during development.

${bold('Usage')}

  ${dim('$')} ${cliCommand} db [command] [options]

${bold('Options')}

  -h, --help   Display this help message
    --config   Custom path to your Prisma config file
    --schema   Custom path to your Prisma schema

${bold('Commands')}
     pull   Pull the state from the database to the Prisma schema using introspection
     push   Push the state from Prisma schema to the database during prototyping
     seed   Seed your database
  execute   Execute native commands to your database

${bold('Examples')}

  Run \`${cliCommand} db pull\`
  ${dim('$')} ${cliCommand} db pull

  Run \`${cliCommand} db push\`
  ${dim('$')} ${cliCommand} db push

  Run \`${cliCommand} db seed\`
  ${dim('$')} ${cliCommand} db seed

  Run \`${cliCommand} db execute\`
  ${dim('$')} ${cliCommand} db execute
`)
}

export class DbCommand implements Command {
  public static new(cmds: Commands, cliCommand: string): DbCommand {
    return new DbCommand(cmds, cliCommand)
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
      '--telemetry-information': String,
    })

    if (isError(args)) {
      return this.help(args.message)
    }

    if (args._.length === 0 || args['--help']) {
      return this.help()
    }

    const cmd = this.cmds[args._[0]]
    if (cmd) {
      const argsForCmd = args['--preview-feature'] ? [...args._.slice(1), `--preview-feature`] : args._.slice(1)
      return cmd.parse(argsForCmd, config, baseDir)
    }

    return unknownCommand(renderHelp(this.cliCommand), args._[0])
  }

  public help(error?: string): string | HelpError {
    const help = renderHelp(this.cliCommand)

    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${help}`)
    }
    return help
  }
}
