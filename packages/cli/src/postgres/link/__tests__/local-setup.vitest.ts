import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { checkGitignore, formatEnvSummary, isAlreadyLinked, upsertEnvFile, writeLocalFiles } from '../local-setup'
import type { ConnectionResult } from '../management-api'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-link-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('upsertEnvFile', () => {
  test('creates .env when it does not exist', () => {
    const envPath = path.join(tmpDir, '.env')
    const result = upsertEnvFile(envPath, {
      DATABASE_URL: 'postgres://localhost:5432/db',
    })

    expect(result.created).toBe(true)
    expect(result.added).toEqual(['DATABASE_URL'])
    expect(result.updated).toEqual([])

    const content = fs.readFileSync(envPath, 'utf-8')
    expect(content).toEqual("DATABASE_URL='postgres://localhost:5432/db'\n")
  })

  test('appends new keys to existing .env', () => {
    const envPath = path.join(tmpDir, '.env')
    fs.writeFileSync(envPath, 'EXISTING_VAR="hello"\n', 'utf-8')

    const result = upsertEnvFile(envPath, {
      DATABASE_URL: 'postgres://localhost:5432/db',
    })

    expect(result.created).toBe(false)
    expect(result.added).toEqual(['DATABASE_URL'])
    expect(result.updated).toEqual([])

    const content = fs.readFileSync(envPath, 'utf-8')
    expect(content).toEqual('EXISTING_VAR="hello"\nDATABASE_URL=\'postgres://localhost:5432/db\'\n')
  })

  test('updates existing keys in .env', () => {
    const envPath = path.join(tmpDir, '.env')
    fs.writeFileSync(envPath, 'DATABASE_URL="old-value"\n', 'utf-8')

    const result = upsertEnvFile(envPath, {
      DATABASE_URL: 'postgres://localhost:5432/new-db',
    })

    expect(result.created).toBe(false)
    expect(result.updated).toEqual(['DATABASE_URL'])
    expect(result.added).toEqual([])

    const content = fs.readFileSync(envPath, 'utf-8')
    expect(content).toEqual("DATABASE_URL='postgres://localhost:5432/new-db'\n")
  })

  test('handles multiple entries (update + add)', () => {
    const envPath = path.join(tmpDir, '.env')
    fs.writeFileSync(envPath, 'DATABASE_URL="old-value"\n', 'utf-8')

    const result = upsertEnvFile(envPath, {
      DATABASE_URL: 'new-pooled-url',
      DIRECT_URL: 'new-direct-url',
    })

    expect(result.updated).toEqual(['DATABASE_URL'])
    expect(result.added).toEqual(['DIRECT_URL'])

    const content = fs.readFileSync(envPath, 'utf-8')
    expect(content).toEqual("DATABASE_URL='new-pooled-url'\nDIRECT_URL='new-direct-url'\n")
  })

  test('does not expand $ in values when using single quotes', () => {
    const envPath = path.join(tmpDir, '.env')
    const result = upsertEnvFile(envPath, {
      DATABASE_URL: 'prisma+postgres://accelerate.prisma-data.net/?api_key=$ecret',
    })

    expect(result.created).toBe(true)
    const content = fs.readFileSync(envPath, 'utf-8')
    expect(content).toEqual("DATABASE_URL='prisma+postgres://accelerate.prisma-data.net/?api_key=$ecret'\n")
  })
})

describe('checkGitignore', () => {
  test('returns no-file when .gitignore does not exist', () => {
    expect(checkGitignore(tmpDir)).toBe('no-file')
  })

  test('returns ok when .gitignore contains .env', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules\n.env\n', 'utf-8')
    expect(checkGitignore(tmpDir)).toBe('ok')
  })

  test('returns ok when .gitignore contains /.env', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '/.env\n', 'utf-8')
    expect(checkGitignore(tmpDir)).toBe('ok')
  })

  test('returns missing-entry when .gitignore does not contain .env', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules\ndist\n', 'utf-8')
    expect(checkGitignore(tmpDir)).toBe('missing-entry')
  })
})

describe('writeLocalFiles', () => {
  test('writes DATABASE_URL to .env', () => {
    const connection: ConnectionResult = {
      connectionString: 'postgres://user:pass@db.prisma.io:5432/postgres',
    }

    const result = writeLocalFiles(tmpDir, connection)

    expect(result.env.created).toBe(true)

    const envContent = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8')
    expect(envContent).toEqual("DATABASE_URL='postgres://user:pass@db.prisma.io:5432/postgres'\n")
  })
})

describe('isAlreadyLinked', () => {
  test('returns false when no .env exists', () => {
    expect(isAlreadyLinked(tmpDir)).toBe(false)
  })

  test('returns false when DATABASE_URL is not a Prisma Postgres URL', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), "DATABASE_URL='postgres://localhost:5432/mydb'\n", 'utf-8')
    expect(isAlreadyLinked(tmpDir)).toBe(false)
  })

  test('returns true when DATABASE_URL points to db.prisma.io', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      "DATABASE_URL='postgres://user:pass@db.prisma.io:5432/postgres'\n",
      'utf-8',
    )
    expect(isAlreadyLinked(tmpDir)).toBe(true)
  })

  test('returns true when DATABASE_URL points to db-pool.prisma.io', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      "DATABASE_URL='postgres://user:pass@db-pool.prisma.io:5432/postgres'\n",
      'utf-8',
    )
    expect(isAlreadyLinked(tmpDir)).toBe(true)
  })

  test('returns false when .env exists but has no DATABASE_URL', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), "OTHER_VAR='value'\n", 'utf-8')
    expect(isAlreadyLinked(tmpDir)).toBe(false)
  })
})

describe('formatEnvSummary', () => {
  test('reports created .env', () => {
    const summary = formatEnvSummary({
      env: { created: true, updated: [], added: ['DATABASE_URL'] },
      gitignoreStatus: 'ok',
    })
    expect(summary).toMatchInlineSnapshot(`"  Created .env with connection strings"`)
  })

  test('includes gitignore warning when entry is missing', () => {
    const summary = formatEnvSummary({
      env: { created: true, updated: [], added: ['DATABASE_URL'] },
      gitignoreStatus: 'missing-entry',
    })
    expect(summary).toMatchInlineSnapshot(`
      "  Created .env with connection strings
        warn Your .gitignore does not include .env — add it to avoid committing secrets"
    `)
  })

  test('includes gitignore warning when no file exists', () => {
    const summary = formatEnvSummary({
      env: { created: true, updated: [], added: ['DATABASE_URL'] },
      gitignoreStatus: 'no-file',
    })
    expect(summary).toMatchInlineSnapshot(`
      "  Created .env with connection strings
        warn No .gitignore found — create one and add .env to avoid committing secrets"
    `)
  })
})
