import { format } from '@prisma/internals'
import { bold, dim } from 'kleur/colors'

import type { CliDistributionIdentity } from '../../utils/cli-distribution-identity'

interface HelpOptions {
  subcommands: [string, string][]
  examples: string[]
}

export function createHelp(identity: CliDistributionIdentity, { subcommands, examples }: HelpOptions): string {
  const maxNameLen = Math.max(...subcommands.map(([name]) => name.length))
  const subcommandLines = subcommands.map(([name, desc]) => `    ${name.padEnd(maxNameLen)}   ${desc}`).join('\n')
  const exampleLines = examples.map((example) => `    ${dim('$')} ${example}`).join('\n')

  return format(`
  Prisma Data Platform commands

  ${bold('Usage')}

    ${dim('$')} ${identity} platform [command]

  ${bold('Commands')}

${subcommandLines}

  ${bold('Flags')}

    -h, --help   Display this help message

  ${bold('Examples')}

${exampleLines}
`)
}
