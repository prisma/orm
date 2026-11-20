import { green } from 'kleur/colors'

import { link } from '..'
import type { PrismaConfigWithDatasource } from '../utils/validatePrismaConfigWithDatasource'

/**
 * Get the message to display when a command is forbidden with a data proxy flag
 * @param command the full cli command (eg. prisma db push)
 * @returns
 */
export const forbiddenCmdWithDataProxyFlagMessage = (command: string) => `
Using an Accelerate URL is not supported for this CLI command ${green(command)} yet.
Please use a direct connection to your database in \`prisma7.config.ts\`.

More information about this limitation: ${link('https://pris.ly/d/accelerate-limitations')}
`

/**
 * Check that the data proxy cannot be used through the given urls and schema contexts
 * @param command the full cli command (eg. prisma db push)
 * @param validatedConfig the validated Prisma Config value
 */
export function checkUnsupportedDataProxy({
  command,
  validatedConfig,
}: {
  command: string
  validatedConfig: PrismaConfigWithDatasource
}) {
  if (validatedConfig.datasource.url.startsWith('prisma://')) {
    throw new Error(forbiddenCmdWithDataProxyFlagMessage(command))
  }
}
