import fs from 'node:fs'
import path from 'node:path'

import dotenv from 'dotenv'
import { bold, yellow } from 'kleur/colors'

import type { ConnectionResult } from './management-api'

/** Tracks which keys were created, updated, or added when writing an `.env` file. */
export interface EnvWriteResult {
  created: boolean
  updated: string[]
  added: string[]
}

/** Creates or patches an `.env` file, inserting new keys and rewriting existing ones in place. */
export function upsertEnvFile(envPath: string, entries: Record<string, string>): EnvWriteResult {
  const result: EnvWriteResult = { created: false, updated: [], added: [] }

  if (!fs.existsSync(envPath)) {
    const lines = Object.entries(entries).map(([key, value]) => `${key}='${value}'`)
    fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8')
    result.created = true
    result.added = Object.keys(entries)
    return result
  }

  let content = fs.readFileSync(envPath, 'utf-8')
  const existingVars = dotenv.parse(content)

  for (const [key, value] of Object.entries(entries)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`^(\\s*${escapedKey}\\s*=).*$`, 'gm')
    if (regex.test(content)) {
      regex.lastIndex = 0
      content = content.replace(regex, (_match, prefix) => `${prefix}'${value}'`)
      result.updated.push(key)
    } else if (key in existingVars) {
      result.updated.push(key)
    } else {
      content = content.trimEnd() + `\n${key}='${value}'\n`
      result.added.push(key)
    }
  }

  fs.writeFileSync(envPath, content, 'utf-8')
  return result
}

/** Whether `.gitignore` covers `.env` files: present and covering, missing the entry, or absent entirely. */
export type GitignoreStatus = 'ok' | 'missing-entry' | 'no-file'

/** Returns whether `.gitignore` in `projectDir` already ignores `.env` files. */
export function checkGitignore(projectDir: string): GitignoreStatus {
  const gitignorePath = path.join(projectDir, '.gitignore')

  if (!fs.existsSync(gitignorePath)) {
    return 'no-file'
  }

  const content = fs.readFileSync(gitignorePath, 'utf-8')
  const lines = content.split('\n').map((l) => l.trim())

  const hasEnvEntry = lines.some((line) => {
    const normalized = line.startsWith('/') ? line.slice(1) : line
    return normalized === '.env' || normalized === '.env*'
  })
  return hasEnvEntry ? 'ok' : 'missing-entry'
}

/** Combined result of writing `.env` and checking `.gitignore`. */
export interface WriteLocalFilesResult {
  env: EnvWriteResult
  gitignoreStatus: GitignoreStatus
}

const PRISMA_POSTGRES_URL_PATTERN = /^postgres(ql)?:\/\/[^@]*@db(-pool)?\.prisma\.io/

/** Checks if `DATABASE_URL` in the project's `.env` already points to a Prisma Postgres instance. */
export function isAlreadyLinked(projectDir: string): boolean {
  const envPath = path.join(projectDir, '.env')

  if (!fs.existsSync(envPath)) {
    return false
  }

  const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf-8'))
  return PRISMA_POSTGRES_URL_PATTERN.test(parsed.DATABASE_URL ?? '')
}

/** Writes connection strings to `.env` and reports the `.gitignore` status. */
export function writeLocalFiles(projectDir: string, connection: ConnectionResult): WriteLocalFilesResult {
  const envPath = path.join(projectDir, '.env')

  const envEntries: Record<string, string> = {
    DATABASE_URL: connection.connectionString,
  }

  const env = upsertEnvFile(envPath, envEntries)
  const gitignoreStatus = checkGitignore(projectDir)

  return { env, gitignoreStatus }
}

/** Formats a human-readable summary of `.env` writes and `.gitignore` warnings. */
export function formatEnvSummary(result: WriteLocalFilesResult): string {
  const lines: string[] = []

  if (result.env.created) {
    lines.push(`  Created ${bold('.env')} with connection strings`)
  } else {
    if (result.env.updated.length > 0) {
      lines.push(`  Updated in ${bold('.env')}: ${result.env.updated.join(', ')}`)
    }
    if (result.env.added.length > 0) {
      lines.push(`  Added to ${bold('.env')}: ${result.env.added.join(', ')}`)
    }
  }

  if (result.gitignoreStatus === 'missing-entry') {
    lines.push(
      `  ${yellow('warn')} Your ${bold('.gitignore')} does not include ${bold('.env')} — add it to avoid committing secrets`,
    )
  } else if (result.gitignoreStatus === 'no-file') {
    lines.push(
      `  ${yellow('warn')} No ${bold('.gitignore')} found — create one and add ${bold('.env')} to avoid committing secrets`,
    )
  }

  return lines.join('\n')
}
