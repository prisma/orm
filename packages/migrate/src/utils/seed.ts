import Debug from '@prisma/debug'
import { execaCommand, type ExecaError } from 'execa'
import { bold, italic, red } from 'kleur/colors'

const debug = Debug('prisma:migrate:seed')

export async function executeSeedCommand({
  commandFromConfig,
  extraArgs,
}: {
  commandFromConfig: string
  extraArgs?: string
}): Promise<boolean> {
  // extraArgs can be passed in `DbSeed.ts` for the extra args after a -- separator
  // Example: db seed -- --custom-arg
  // Then extraArgs will be '--custom-arg'
  const command = extraArgs ? `${commandFromConfig} ${extraArgs}` : commandFromConfig
  process.stdout.write(`Running seed command \`${italic(command)}\` ...\n`)

  try {
    await execaCommand(command, {
      stdout: 'inherit',
      stderr: 'inherit',
    })
  } catch (_e) {
    const e = _e as ExecaError
    debug({ e })
    console.error(bold(red(`\nAn error occurred while running the seed command:`)))
    console.error(red(e.stderr || String(e)))
    return false
  }

  return true
}
