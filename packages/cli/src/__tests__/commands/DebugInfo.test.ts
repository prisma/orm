import { stripVTControlCharacters } from 'node:util'

import { defaultTestConfig } from '@prisma/config'
import { jestConsoleContext, jestContext } from '@prisma/get-platform'
import path from 'path'

import { DebugInfo } from '../../DebugInfo'

const testIf = (condition: boolean) => (condition ? test : test.skip)

const ctx = jestContext.new().add(jestConsoleContext()).assemble()

const originalEnv = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function cleanSnapshot(str: string): string {
  str = str.replace(new RegExp('(Path: ).*', 'g'), '$1REDACTED_PATH')
  return str
}

const envVars = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  DEBUG: 'something',
  NODE_ENV: 'test',
  RUST_LOG: 'trace',
  RUST_BACKTRACE: 'full',
  NO_COLOR: 'true',
  TERM: 'dumb',
  NODE_TLS_REJECT_UNAUTHORIZED: 'true',
  NO_PROXY: '*',
  http_proxy: 'http://http_proxy.localhost',
  HTTP_PROXY: 'http://HTTP_PROXY.localhost',
  https_proxy: 'https://https_proxy.localhost',
  HTTPS_PROXY: 'https://HTTPS_PROXY.localhost',
  PRISMA_DISABLE_WARNINGS: 'true',
  PRISMA_HIDE_PREVIEW_FLAG_WARNINGS: 'true',
  PRISMA_HIDE_UPDATE_MESSAGE: 'true',
  PRISMA_ENGINES_MIRROR: 'http://localhost',
  PRISMA_BINARIES_MIRROR: 'http://localhost',
  PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING: 'true',
  BINARY_DOWNLOAD_VERSION: 'true',
  PRISMA_SCHEMA_ENGINE_BINARY: 'some/path',
  PRISMA_MIGRATION_ENGINE_BINARY: 'true',
  PRISMA_SHOW_ALL_TRACES: 'true',
  PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: 'true',
  BROWSER: 'something',
}

describe('debug', () => {
  // make sure the env is empty before each test
  beforeEach(() => {
    restoreEnv()
    for (const key of Object.keys(process.env)) {
      delete process.env[key]
    }
  })
  // clean up env vars after each individual test
  afterEach(() => {
    restoreEnv()
  })

  it('should succeed when env vars are NOT set (undefined)', async () => {
    ctx.fixture('example-project/prisma')

    // Make sure all env vars are undefined
    Object.keys(envVars).map((key) => delete process.env[key])

    // To make sure the terminal is always detected
    // as non interactive, locally and in CI
    process.env.TERM = 'dumb'

    const result = await DebugInfo.new('prisma').parse([], defaultTestConfig())

    expect(cleanSnapshot(result as string)).toMatchInlineSnapshot(`
      "-- Prisma schema --
      Path: REDACTED_PATH

      -- Local cache directory for engines files --
      Path: REDACTED_PATH

      -- Environment variables --
      When not set, the line is dimmed and no value is displayed.
      When set, the line is bold and the value is inside the \`\` backticks.

      For general debugging
      - CI:
      - DEBUG:
      - NODE_ENV:
      - RUST_LOG:
      - RUST_BACKTRACE:
      - NO_COLOR:
      - TERM: \`dumb\`
      - NODE_TLS_REJECT_UNAUTHORIZED:
      - NO_PROXY:
      - http_proxy:
      - HTTP_PROXY:
      - https_proxy:
      - HTTPS_PROXY:

      For more information about Prisma environment variables:
      See https://pris.ly/d/env-vars

      For hiding messages
      - PRISMA_DISABLE_WARNINGS:
      - PRISMA_HIDE_PREVIEW_FLAG_WARNINGS:
      - PRISMA_HIDE_UPDATE_MESSAGE:

      For downloading engines
      - PRISMA_ENGINES_MIRROR:
      - PRISMA_BINARIES_MIRROR (deprecated):
      - PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING:
      - BINARY_DOWNLOAD_VERSION:

      For custom engines
      - PRISMA_SCHEMA_ENGINE_BINARY:
      - PRISMA_MIGRATION_ENGINE_BINARY:

      For Prisma Client
      - PRISMA_SHOW_ALL_TRACES:

      For Prisma Migrate
      - PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK:

      For Prisma Studio
      - BROWSER:

      -- Terminal is interactive? --
      false

      -- CI detected? --
      false
      "
    `)
  })

  it('should succeed when env vars are set to empty', async () => {
    ctx.fixture('example-project/prisma')

    // Make sure all env vars are set to ''
    const envVarsSetToEmptyString = Object.fromEntries(Object.keys(envVars).map((key) => [key, '']))
    Object.assign(process.env, envVarsSetToEmptyString)
    // To make sure the terminal is always detected
    // as non interactive, locally and in CI
    process.env.TERM = 'dumb'

    const result = await DebugInfo.new('prisma').parse([], defaultTestConfig())

    expect(cleanSnapshot(result as string)).toMatchInlineSnapshot(`
      "-- Prisma schema --
      Path: REDACTED_PATH

      -- Local cache directory for engines files --
      Path: REDACTED_PATH

      -- Environment variables --
      When not set, the line is dimmed and no value is displayed.
      When set, the line is bold and the value is inside the \`\` backticks.

      For general debugging
      - CI: \`\`
      - DEBUG: \`\`
      - NODE_ENV: \`\`
      - RUST_LOG: \`\`
      - RUST_BACKTRACE: \`\`
      - NO_COLOR: \`\`
      - TERM: \`dumb\`
      - NODE_TLS_REJECT_UNAUTHORIZED: \`\`
      - NO_PROXY: \`\`
      - http_proxy: \`\`
      - HTTP_PROXY: \`\`
      - https_proxy: \`\`
      - HTTPS_PROXY: \`\`

      For more information about Prisma environment variables:
      See https://pris.ly/d/env-vars

      For hiding messages
      - PRISMA_DISABLE_WARNINGS: \`\`
      - PRISMA_HIDE_PREVIEW_FLAG_WARNINGS: \`\`
      - PRISMA_HIDE_UPDATE_MESSAGE: \`\`

      For downloading engines
      - PRISMA_ENGINES_MIRROR: \`\`
      - PRISMA_BINARIES_MIRROR (deprecated): \`\`
      - PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING: \`\`
      - BINARY_DOWNLOAD_VERSION: \`\`

      For custom engines
      - PRISMA_SCHEMA_ENGINE_BINARY: \`\`
      - PRISMA_MIGRATION_ENGINE_BINARY: \`\`

      For Prisma Client
      - PRISMA_SHOW_ALL_TRACES: \`\`

      For Prisma Migrate
      - PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: \`\`

      For Prisma Studio
      - BROWSER: \`\`

      -- Terminal is interactive? --
      false

      -- CI detected? --
      false
      "
    `)
  })

  // Environment variables are case insensitive on Windows, which breaks our test snapshot
  // since HTTP_PROXY overrides http_proxy and HTTPS_PROXY overrides https_proxy.
  testIf(process.platform !== 'win32')('should succeed when env vars are set', async () => {
    ctx.fixture('example-project/prisma')

    Object.assign(process.env, envVars)

    const result = await DebugInfo.new('prisma').parse([], defaultTestConfig())

    expect(cleanSnapshot(result as string)).toMatchInlineSnapshot(`
      "-- Prisma schema --
      Path: REDACTED_PATH

      -- Local cache directory for engines files --
      Path: REDACTED_PATH

      -- Environment variables --
      When not set, the line is dimmed and no value is displayed.
      When set, the line is bold and the value is inside the \`\` backticks.

      For general debugging
      - CI: \`true\`
      - DEBUG: \`something\`
      - NODE_ENV: \`test\`
      - RUST_LOG: \`trace\`
      - RUST_BACKTRACE: \`full\`
      - NO_COLOR: \`true\`
      - TERM: \`dumb\`
      - NODE_TLS_REJECT_UNAUTHORIZED: \`true\`
      - NO_PROXY: \`*\`
      - http_proxy: \`http://http_proxy.localhost\`
      - HTTP_PROXY: \`http://HTTP_PROXY.localhost\`
      - https_proxy: \`https://https_proxy.localhost\`
      - HTTPS_PROXY: \`https://HTTPS_PROXY.localhost\`

      For more information about Prisma environment variables:
      See https://pris.ly/d/env-vars

      For hiding messages
      - PRISMA_DISABLE_WARNINGS: \`true\`
      - PRISMA_HIDE_PREVIEW_FLAG_WARNINGS: \`true\`
      - PRISMA_HIDE_UPDATE_MESSAGE: \`true\`

      For downloading engines
      - PRISMA_ENGINES_MIRROR: \`http://localhost\`
      - PRISMA_BINARIES_MIRROR (deprecated): \`http://localhost\`
      - PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING: \`true\`
      - BINARY_DOWNLOAD_VERSION: \`true\`

      For custom engines
      - PRISMA_SCHEMA_ENGINE_BINARY: \`some/path\`
      - PRISMA_MIGRATION_ENGINE_BINARY: \`true\`

      For Prisma Client
      - PRISMA_SHOW_ALL_TRACES: \`true\`

      For Prisma Migrate
      - PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: \`true\`

      For Prisma Studio
      - BROWSER: \`something\`

      -- Terminal is interactive? --
      false

      -- CI detected? --
      true
      "
    `)
  })

  it('should succeed with --schema', async () => {
    ctx.fixture('example-project/prisma')
    const result = stripVTControlCharacters(
      (await DebugInfo.new('prisma').parse(['--schema=schema.prisma'], defaultTestConfig())) as string,
    )

    expect(result).toContain(`Path: ${path.join(process.cwd(), 'schema.prisma')}`)
  })

  it('should load schema located next to a nested config', async () => {
    ctx.fixture('prisma-config-nested')
    const configDir = path.join(process.cwd(), 'config')
    const result = stripVTControlCharacters(
      (await DebugInfo.new('prisma').parse(
        ['--config=./config/prisma.config.ts'],
        defaultTestConfig(),
        configDir,
      )) as string,
    )

    expect(result).toContain(`Path: ${path.join(configDir, 'schema.prisma')}`)
  })

  it('should succeed with incorrect --schema path', async () => {
    await expect(
      DebugInfo.new('prisma').parse(['--schema=does-not-exists.prisma'], defaultTestConfig()),
    ).resolves.toContain(
      'Could not load `--schema` from provided path `does-not-exists.prisma`: file or directory not found',
    )
  })
})
