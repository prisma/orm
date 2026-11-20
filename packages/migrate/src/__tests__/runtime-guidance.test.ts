import { validatePrismaConfigWithDatasource } from '@prisma/internals'

import type { MigrationFeedback } from '../types'
import { DbPushIgnoreWarningsWithFlagError, MigrateDevEnvNonInteractiveError } from '../utils/errors'
import { handleUnexecutableSteps } from '../utils/handleEvaluateDataloss'

describe.each(['prisma', 'prisma7'] as const)('%s', (cliCommand) => {
  const otherCliCommand = cliCommand === 'prisma' ? 'prisma7' : 'prisma'

  it('renders config validation with the selected executable', () => {
    expect(() =>
      validatePrismaConfigWithDatasource({
        config: {},
        command: `${cliCommand} migrate deploy`,
      }),
    ).toThrow(`${cliCommand} migrate deploy`)

    expect(() =>
      validatePrismaConfigWithDatasource({
        config: {},
        command: `${cliCommand} migrate deploy`,
      }),
    ).not.toThrow(`${otherCliCommand} migrate deploy`)
  })

  it('renders warning and non-interactive errors with the selected executable', () => {
    expect(new DbPushIgnoreWarningsWithFlagError(cliCommand).message).toContain(
      `${cliCommand} db push --accept-data-loss`,
    )
    expect(new DbPushIgnoreWarningsWithFlagError(cliCommand).message).not.toContain(
      `${otherCliCommand} db push --accept-data-loss`,
    )

    expect(new MigrateDevEnvNonInteractiveError(cliCommand).message).toContain(`\`${cliCommand} migrate dev\``)
    expect(new MigrateDevEnvNonInteractiveError(cliCommand).message).toContain(`${cliCommand} migrate deploy`)
    expect(new MigrateDevEnvNonInteractiveError(cliCommand).message).not.toContain(`${otherCliCommand} migrate deploy`)
  })

  it('renders next steps with the selected executable', () => {
    const unexecutableSteps: MigrationFeedback[] = [
      {
        stepIndex: 1,
        message: 'made the column `name` required',
      },
    ]

    const unexecutableMessage = handleUnexecutableSteps(unexecutableSteps, cliCommand, false)

    expect(unexecutableMessage).toContain(`${cliCommand} migrate dev --create-only`)
    expect(unexecutableMessage).toContain(`${cliCommand} migrate dev`)
    expect(unexecutableMessage).not.toContain(`${otherCliCommand} migrate dev --create-only`)

    expect(unexecutableMessage).not.toContain(`${otherCliCommand} migrate dev`)
  })
})
