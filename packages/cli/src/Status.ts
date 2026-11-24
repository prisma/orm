import type { PrismaConfigInternal } from '@prisma/config'
import type { Command } from '@prisma/internals'
import { arg, format, HelpError, isError } from '@prisma/internals'
import { bold, dim, red } from 'kleur/colors'

import { fetchStatus } from './status-page'
import type { CliDistributionIdentity } from './utils/cli-distribution-identity'

/** $ prisma platform status */
export class Status implements Command {
  static new(identity: CliDistributionIdentity): Status {
    return new Status(identity)
  }

  constructor(private readonly identity: CliDistributionIdentity) {}

  public help(error?: string): string | HelpError {
    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${createHelp(this.identity)}`)
    }

    return createHelp(this.identity)
  }

  async parse(argv: string[], _config: PrismaConfigInternal): Promise<string | Error> {
    const args = arg(argv, {
      '--help': Boolean,
      '-h': '--help',
      '--json': Boolean,
      '--telemetry-information': String,
    })

    if (isError(args)) {
      return this.help(args.message)
    }

    if (args['--help']) {
      return this.help()
    }

    return fetchStatus(args['--json'] ?? false)
  }
}

function createHelp(identity: CliDistributionIdentity): string {
  return format(`
  Show Prisma Data Platform service status

  ${bold('Usage')}

  ${dim('$')} ${identity} platform status [options]

  ${bold('Options')}

    -h, --help     Display this help message
        --json     Output raw JSON from the status API
`)
}
