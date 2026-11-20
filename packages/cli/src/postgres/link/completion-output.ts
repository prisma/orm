import { getCommandWithExecutor } from '@prisma/internals'
import { bold, dim, green } from 'kleur/colors'

import type { CliDistributionIdentity } from '../../utils/cli-distribution-identity'
import type { LinkResult } from './Link'
import { formatEnvSummary } from './local-setup'

export function formatCompletionOutput(opts: LinkResult, identity: CliDistributionIdentity): string {
  const cliCommand = identity
  const lines: string[] = []

  lines.push('')
  lines.push(green('✔') + bold(' Prisma Postgres linked successfully!'))
  lines.push('')
  lines.push(formatEnvSummary(opts.localFilesResult))
  lines.push('')
  lines.push(bold('Next steps:'))

  if (opts.hasModels) {
    lines.push(`  1. Run ${green(getCommandWithExecutor(`${cliCommand} generate`))} to generate the Prisma Client`)
    lines.push(
      `  2. Run ${green(getCommandWithExecutor(`${cliCommand} migrate dev`))} to apply your schema to the database`,
    )
    lines.push(
      `  3. Start querying: ${dim('https://www.prisma.io/docs/getting-started/quickstart#4-explore-how-to-send-queries-to-your-database-with-prisma-client')}`,
    )
  } else {
    lines.push(`  1. Define your data model in ${green('prisma/schema.prisma')}`)
    lines.push(`  2. Run ${green(getCommandWithExecutor(`${cliCommand} migrate dev`))} to create the database tables`)
    lines.push(`  3. Run ${green(getCommandWithExecutor(`${cliCommand} generate`))} and start querying`)
  }

  lines.push('')

  return lines.join('\n')
}
