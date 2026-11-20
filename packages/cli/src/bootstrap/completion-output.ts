import { getCommandWithExecutor } from '@prisma/internals'
import { bold, dim, green, red } from 'kleur/colors'

import { type CliDistributionIdentity, getCliDistributionPackageName } from '../utils/cli-distribution-identity'

type StepResult = 'completed' | 'skipped' | 'not-applicable' | 'failed'

export interface BootstrapStepStatus {
  init: 'completed' | 'skipped'
  template: StepResult
  link: 'completed' | 'skipped' | 'failed'
  generate: StepResult
  migrate: StepResult
  seed: StepResult
}

function statusIcon(status: StepResult): string {
  switch (status) {
    case 'completed':
      return green('✔')
    case 'failed':
      return red('✗')
    case 'skipped':
    case 'not-applicable':
      return dim('–')
  }
}

function statusLabel(status: StepResult): string {
  switch (status) {
    case 'completed':
      return 'done'
    case 'failed':
      return red('failed')
    case 'skipped':
      return 'skipped'
    case 'not-applicable':
      return 'n/a'
  }
}

export function formatBootstrapOutput(opts: {
  databaseId: string
  identity: CliDistributionIdentity
  isNewProject: boolean
  steps: BootstrapStepStatus
  hasModels: boolean
  pendingDepsInstall?: boolean
}): string {
  const cliCommand = opts.identity
  const lines: string[] = []

  lines.push('')
  lines.push(green('✔') + bold(' Bootstrap completed!'))
  lines.push('')
  lines.push(`  ${statusIcon(opts.steps.init)}  Init         ${statusLabel(opts.steps.init)}`)
  lines.push(`  ${statusIcon(opts.steps.template)}  Template     ${statusLabel(opts.steps.template)}`)
  lines.push(`  ${statusIcon(opts.steps.link)}  Link         ${statusLabel(opts.steps.link)}`)
  lines.push(`  ${statusIcon(opts.steps.generate)}  Generate     ${statusLabel(opts.steps.generate)}`)
  lines.push(`  ${statusIcon(opts.steps.migrate)}  Migration    ${statusLabel(opts.steps.migrate)}`)
  lines.push(`  ${statusIcon(opts.steps.seed)}  Seed         ${statusLabel(opts.steps.seed)}`)
  lines.push('')

  if (opts.pendingDepsInstall) {
    lines.push(bold('Next steps:'))
    lines.push(
      `  1. Install ${bold('@prisma/client')}, ${bold('dotenv')}, and ${bold(
        getCliDistributionPackageName(cliCommand),
      )} with your package manager`,
    )
    lines.push(
      `  2. Re-run ${green(`npx ${getCliDistributionPackageName(cliCommand)}@latest bootstrap`)} to finish setup`,
    )
    lines.push('')
    return lines.join('\n')
  }

  lines.push(bold('Next steps:'))

  const clientReady = opts.steps.generate === 'completed' || opts.steps.migrate === 'completed'

  if (opts.hasModels && clientReady) {
    lines.push(
      `  1. Start querying: ${dim('https://www.prisma.io/docs/prisma-orm/quickstart/prisma-postgres#7-instantiate-prisma-client')}`,
    )
    lines.push(`  2. Run ${green(getCommandWithExecutor(`${cliCommand} studio`))} to view your data in the browser`)
  } else if (opts.hasModels) {
    lines.push(`  1. Run ${green(getCommandWithExecutor(`${cliCommand} generate`))} to generate the Prisma Client`)
    lines.push(
      `  2. Start querying: ${dim('https://www.prisma.io/docs/prisma-orm/quickstart/prisma-postgres#7-instantiate-prisma-client')}`,
    )
    lines.push(`  3. Run ${green(getCommandWithExecutor(`${cliCommand} studio`))} to view your data in the browser`)
  } else {
    lines.push(`  1. Define your data model in ${green('prisma/schema.prisma')}`)
    lines.push(`  2. Run ${green(getCommandWithExecutor(`${cliCommand} migrate dev`))} to create the database tables`)
    lines.push(`  3. Run ${green(getCommandWithExecutor(`${cliCommand} studio`))} to view your data in the browser`)
  }

  lines.push('')
  lines.push(dim('Enhance your development workflow:'))
  lines.push(dim(`  Prisma in Cursor  cursor plugin install prisma-cursor-plugin`))
  lines.push(dim(`  Prisma MCP        Add { "url": "https://mcp.prisma.io/mcp" } to .cursor/mcp.json`))
  lines.push(dim(`  Prisma Skills     npx skills add prisma/skills`))
  lines.push('')

  return lines.join('\n')
}
