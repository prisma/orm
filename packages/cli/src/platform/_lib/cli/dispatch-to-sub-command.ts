import type { PrismaConfigInternal } from '@prisma/config'
import type { Commands } from '@prisma/internals'
import { HelpError } from '@prisma/internals'

export const dispatchToSubCommand = async (
  commands: Commands,
  argv: string[],
  config: PrismaConfigInternal,
  baseDir: string,
): Promise<string | Error> => {
  const commandName = argv[0]
  if (!commandName) return new HelpError(`Unknown command.`)
  const command = commands[commandName]
  if (!command) return new HelpError(`Unknown command or parameter "${commandName}"`)
  return command.parse(argv.slice(1), config, baseDir)
}
