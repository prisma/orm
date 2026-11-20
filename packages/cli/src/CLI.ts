import type { PrismaConfigInternal } from '@prisma/config'
import { ensureNeededBinariesExist } from '@prisma/engines'
import type { BinaryPaths, DownloadOptions } from '@prisma/fetch-engine'
import type { Command, Commands } from '@prisma/internals'
import { arg, drawBox, format, HelpError, isError, link, unknownCommand } from '@prisma/internals'
import { bold, dim, green, red } from 'kleur/colors'

import { runCheckpointClientCheck } from './utils/checkpoint'
import type { CliDistributionIdentity } from './utils/cli-distribution-identity'
import { printUpdateMessage } from './utils/printUpdateMessage'
import { Version } from './Version'

/**
 * CLI command
 */
export class CLI implements Command {
  static new(
    cmds: Commands,
    ensureBinaries: string[],
    download: (options: DownloadOptions) => Promise<BinaryPaths>,
    identity: CliDistributionIdentity,
  ): CLI {
    return new CLI(cmds, ensureBinaries, download, identity)
  }

  private constructor(
    private readonly cmds: Commands,
    private readonly ensureBinaries: string[],
    private readonly download: (options: DownloadOptions) => Promise<BinaryPaths>,
    private readonly identity: CliDistributionIdentity,
  ) {}

  async parse(argv: string[], config: PrismaConfigInternal, baseDir: string = process.cwd()): Promise<string | Error> {
    const args = arg(argv, {
      '--help': Boolean,
      '-h': '--help',
      '--version': Boolean,
      '-v': '--version',
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
    if (!args['--version'] && (args._.length === 0 || args['--help'])) {
      return this.help()
    }

    if (args['--version']) {
      await ensureNeededBinariesExist({
        download: this.download,
      })
      return Version.new(this.identity).parse(argv, config, baseDir)
    }

    // check if we have that subcommand
    const cmdName = args._[0]
    // Throw if "lift"
    if (cmdName === 'lift') {
      throw new Error(`${red(`${this.identity} lift`)} has been renamed to ${green(`${this.identity} migrate`)}`)
    }

    const cmd = this.cmds[cmdName]
    if (cmd) {
      const checkResultPromise =
        this.identity === 'prisma'
          ? runCheckpointClientCheck({ schemaPathFromConfig: config.schema, baseDir }).catch(() => {
              /* noop */
            })
          : undefined

      // if we have that subcommand, let's ensure that the binary is there in case the command needs it
      if (this.ensureBinaries.includes(cmdName)) {
        await ensureNeededBinariesExist({
          download: this.download,
        })
      }

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

      const result = await cmd.parse(argsForCmd, config, baseDir)

      if (checkResultPromise) {
        printUpdateMessage(await checkResultPromise)
      }

      return result
    }
    // unknown command
    return unknownCommand(this.help() as string, args._[0])
  }

  public help(error?: string) {
    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${createHelp(this.identity)}`)
    }
    return createHelp(this.identity)
  }

  private static tryPdpMessage = `Optimize performance through connection pooling and caching with Prisma Accelerate.
Learn more at ${link('https://pris.ly/cli/pdp')}`

  static readonly boxedTryPdpMessage = drawBox({
    height: this.tryPdpMessage.split('\n').length,
    width: 0, // calculated automatically
    str: this.tryPdpMessage,
    horizontalPadding: 2,
  })
}

function createHelp(identity: CliDistributionIdentity): string {
  return format(`
    ${
      process.platform === 'win32' ? '' : bold(green('◭  '))
    }Prisma is a modern DB toolkit to query, migrate and model your database (${link('https://prisma.io')})

    ${bold('Usage')}

      ${dim('$')} ${identity} [command]

    ${bold('Commands')}

                init   Set up Prisma for your app
           bootstrap   Bootstrap a Prisma Postgres project
                 dev   Start a local Prisma Postgres server for development
            generate   Generate artifacts (e.g. Prisma Client)
                  db   Manage your database schema and lifecycle
             migrate   Migrate your database
              studio   Browse your data with Prisma Studio
            validate   Validate your Prisma schema
              format   Format your Prisma schema
             version   Displays Prisma version info
               debug   Displays Prisma debug info
            platform   Prisma Data Platform commands
            postgres   Manage Prisma Postgres databases
                 mcp   Starts an MCP server to use with AI development tools
            complete   Generate shell completion scripts

    ${bold('Flags')}

         --preview-feature   Run Preview Prisma commands
         --help, -h          Show additional information about a command

${CLI.boxedTryPdpMessage}

    ${bold('Examples')}

      Set up a new local Prisma Postgres \`${identity} dev\`-ready project
      ${dim('$')} ${identity} init

      Start a local Prisma Postgres server for development
      ${dim('$')} ${identity} dev

      Generate artifacts (e.g. Prisma Client)
      ${dim('$')} ${identity} generate

      Browse your data
      ${dim('$')} ${identity} studio

      Create migrations from your Prisma schema, apply them to the database, generate artifacts (e.g. Prisma Client)
      ${dim('$')} ${identity} migrate dev

      Pull the schema from an existing database, updating the Prisma schema
      ${dim('$')} ${identity} db pull

      Push the Prisma schema state to the database
      ${dim('$')} ${identity} db push

      Validate your Prisma schema
      ${dim('$')} ${identity} validate

      Format your Prisma schema
      ${dim('$')} ${identity} format

      Display Prisma version info
      ${dim('$')} ${identity} version

      Display Prisma debug info
      ${dim('$')} ${identity} debug
  `)
}
