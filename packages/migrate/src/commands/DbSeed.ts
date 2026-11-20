import type { PrismaConfigInternal } from '@prisma/config'
import { arg, Command, format, HelpError, isError } from '@prisma/internals'
import { ArgError } from 'arg'
import { bold, dim, red } from 'kleur/colors'

import { executeSeedCommand } from '../utils/seed'

function renderHelp(cliCommand: string): string {
  return format(`
${process.platform === 'win32' ? '' : '🙌  '}Seed your database

${bold('Usage')}

  ${dim('$')} ${cliCommand} db seed [options]

${bold('Options')}

  -h, --help   Display this help message
    --config   Custom path to your Prisma config file

${bold('Examples')}

  Passing extra arguments to the seed command
    ${dim('$')} ${cliCommand} db seed -- --arg1 value1 --arg2 value2
`)
}

export class DbSeed implements Command {
  public static new(cliCommand: string): DbSeed {
    return new DbSeed(cliCommand)
  }

  private constructor(private readonly cliCommand: string) {}

  public async parse(argv: string[], config: PrismaConfigInternal): Promise<string | Error> {
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
      if (args instanceof ArgError && args.code === 'ARG_UNKNOWN_OPTION') {
        throw new Error(`${args.message}
Did you mean to pass these as arguments to your seed script? If so, add a -- separator before them:
${dim('$')} ${this.cliCommand} db seed -- --arg1 value1 --arg2 value2`)
      }
      return this.help(args.message)
    }

    if (args['--help']) {
      return this.help()
    }

    const seedCommand = config.migrations?.seed

    if (!seedCommand) {
      return format(`⚠️ ${bold('No seed command configured')}

To seed your database, add a ${bold('seed')} property to the ${bold('migrations')} section in your ${bold('Prisma config')} file.

${bold('Example')}

  ${dim('// prisma7.config.ts')}
  export default defineConfig({
    ${bold('migrations: {')}
      ${bold(`seed: 'bun·./prisma/seed.ts'`)},
    ${bold('}')},
    ${dim('datasource: {')}
      ${dim(`url: '[your database URL]'`)},
    ${dim('}')},
  })
`)
    }

    // We pass the extra params after a -- separator
    // Example: db seed -- --custom-param
    // Then args._ will be ['--custom-param']
    const extraArgs = args._.join(' ')

    // Seed command is set
    // Execute user seed command
    const successfulSeeding = await executeSeedCommand({ commandFromConfig: seedCommand, extraArgs })
    if (successfulSeeding) {
      return `\n${process.platform === 'win32' ? '' : '🌱  '}The seed command has been executed.`
    } else {
      process.exit(1)
    }
  }

  public help(error?: string): string | HelpError {
    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${renderHelp(this.cliCommand)}`)
    }
    return renderHelp(this.cliCommand)
  }
}
