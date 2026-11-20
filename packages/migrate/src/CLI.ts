import type { PrismaConfigInternal } from '@prisma/config'
import type { Command, Commands } from '@prisma/internals'
import { arg, format, HelpError, isError, unknownCommand } from '@prisma/internals'
import { bold, red } from 'kleur/colors'

/**
 * Convenient Migrate CLI command, not public facing
 * see public one in packages/cli/ directory
 */
export class CLI implements Command {
  static new(cmds: Commands): CLI {
    return new CLI(cmds)
  }

  private constructor(private readonly cmds: Commands) {}

  async parse(argv: string[], config: PrismaConfigInternal, baseDir: string): Promise<string | Error> {
    const args = arg(argv, {
      '--help': Boolean,
      '-h': '--help',
      '--config': String,
      '--json': Boolean, // for -v
      '--experimental': Boolean,
      '--preview-feature': Boolean,
      '--early-access': Boolean,
      '--telemetry-information': String,
    })

    if (isError(args)) {
      return this.help(args.message)
    }

    // display help for help flag or no subcommand
    if (args._.length === 0 || args['--help']) {
      return this.help()
    }

    // check if we have that subcommand
    const cmdName = args._[0]
    const cmd = this.cmds[cmdName]
    if (cmd) {
      let argsForCmd: string[]
      if (args['--experimental']) {
        argsForCmd = [...args._.slice(1), `--experimental=${args['--experimental']}`]
      } else if (args['--preview-feature']) {
        argsForCmd = [...args._.slice(1), `--preview-feature=${args['--preview-feature']}`]
      } else if (args['--early-access']) {
        argsForCmd = [...args._.slice(1), `--early-access=${args['--early-access']}`]
      } else {
        argsForCmd = args._.slice(1)
      }

      return cmd.parse(argsForCmd, config, baseDir)
    }
    // unknown command
    return unknownCommand(this.help() as string, args._[0])
  }

  public help(error?: string) {
    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${CLI.help}`)
    }
    return CLI.help
  }

  private static help = format(`This is the internal CLI for @prisma/migrate`)
}
