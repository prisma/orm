import { Debug } from '@prisma/debug'
import paths from 'env-paths'
import fs from 'fs'
import path from 'path'

const debug = Debug('prisma:cli:commandState')

export interface CommandState {
  firstCommandTimestamp: string
}

function getCommandStatePath(): string {
  return path.join(paths('prisma').config, 'commands.json')
}

/*
 * Loads the command state from a file, or initializes it if it doesn't exist.
 * The command state contains the timestamp of the first command issued.
 */
export async function loadOrInitializeCommandState(): Promise<CommandState> {
  const filePath = getCommandStatePath()
  const data = await fs.promises.readFile(filePath, 'utf-8').catch((err) => {
    if (err.code !== 'ENOENT') {
      debug('Failed to read command state: %O', err)
    }
    return undefined
  })

  let state: CommandState | undefined
  if (data !== undefined) {
    try {
      const parsed = JSON.parse(data)
      if (parsed && typeof parsed.firstCommandTimestamp === 'string') {
        state = parsed
      }
    } catch (err) {
      debug('Failed to parse command state: %O', err)
    }
  }

  if (state === undefined) {
    state = { firstCommandTimestamp: new Date().toISOString() }
    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      const tempFilePath = `${filePath}.tmp`
      await fs.promises.writeFile(tempFilePath, JSON.stringify(state))
      await fs.promises.rename(tempFilePath, filePath)
    } catch (err) {
      debug('Failed to write command state: %O', err)
    }
  }

  return state
}

/*
 * Calculates the number of days since the first command was issued.
 */
export function daysSinceFirstCommand(state: CommandState, now: Date = new Date()): number {
  const firstCommandDate = new Date(state.firstCommandTimestamp)
  const diffTime = now.getTime() - firstCommandDate.getTime()
  return Math.floor(diffTime / (1000 * 60 * 60 * 24))
}
