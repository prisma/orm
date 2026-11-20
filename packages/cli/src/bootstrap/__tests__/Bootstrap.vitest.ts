import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { defaultTestConfig } from '@prisma/config'
import { HelpError } from '@prisma/internals'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { Bootstrap } from '../Bootstrap'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

vi.mock('@prisma/management-api-sdk', () => {
  class AuthErrorMock extends Error {
    name = 'AuthError'
    constructor(
      message: string,
      public readonly refreshTokenInvalid = false,
    ) {
      super(message)
    }
  }
  return {
    createManagementApiClient: vi.fn(() => mockSdkClient),
    AuthError: AuthErrorMock,
  }
})

vi.mock('../../../management-api/auth', () => ({
  login: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../../management-api/auth-client', () => ({
  createAuthenticatedManagementAPI: vi.fn(() => ({ client: mockSdkClient })),
}))

vi.mock('../../../management-api/token-storage', () => ({
  FileTokenStorage: class {
    getTokens() {
      return Promise.resolve({ accessToken: 'stored_token', workspaceId: 'wksp_1' })
    }
  },
}))

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('checkpoint-client', () => ({
  getSignature: vi.fn(() => Promise.resolve('test-signature-123')),
}))

vi.mock('../../utils/nps/capture', () => ({
  PUBLIC_POSTHOG_BOOTSTRAP_ACTIVATION_PROJECT_KEY: 'phc_test_bootstrap_key',
  PosthogEventCapture: class {
    async capture() {}
  },
}))

vi.mock('@prisma/migrate', () => ({
  MigrateDev: {
    new: () => ({
      parse: vi.fn(() => Promise.resolve('Migration completed')),
    }),
  },
  DbSeed: {
    new: () => ({
      parse: vi.fn(() => Promise.resolve('Seed completed')),
    }),
  },
}))

vi.mock('../../Init', () => ({
  Init: {
    new: () => ({
      parse: vi.fn(() => Promise.resolve('Prisma initialized')),
    }),
  },
}))

vi.mock('../template-scaffold', () => ({
  addDependencies: vi.fn(() => Promise.resolve()),
  addDevDependencies: vi.fn(() => Promise.resolve()),
  detectPackageManager: vi.fn(() => 'npm'),
  downloadAndExtractTemplate: vi.fn(() => Promise.resolve()),
  installDependencies: vi.fn(),
  isValidTemplateName: vi.fn((name: string) => ['nextjs', 'express'].includes(name)),
  promptTemplateSelection: vi.fn(() => Promise.resolve('nextjs')),
}))

const mockSdkClient = {
  GET: vi.fn(),
  POST: vi.fn(),
}

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-bootstrap-'))
  vi.mocked(execFileSync).mockReset()
  mockSdkClient.GET.mockReset()
  mockSdkClient.POST.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function setupMockApiSuccess() {
  mockSdkClient.POST.mockResolvedValueOnce({
    data: {
      data: {
        id: 'conn_test',
        name: `dev-${os.hostname()}`,
        endpoints: {
          pooled: { connectionString: 'postgres://user:pass@db-pool.prisma.io:5432/postgres' },
          direct: { connectionString: 'postgres://user:pass@db.prisma.io:5432/postgres' },
        },
      },
    },
    error: undefined,
  })
}

describe('Bootstrap command — help and validation', () => {
  test('shows help with --help flag', async () => {
    const result = await Bootstrap.new('prisma').parse(['--help'], defaultTestConfig(), tmpDir)
    expect(result).toContain('prisma bootstrap')
  })

  test('returns error when --api-key is given without --database', async () => {
    const result = await Bootstrap.new('prisma').parse(['--api-key', 'test_key'], defaultTestConfig(), tmpDir)
    expect(result).toBeInstanceOf(HelpError)
    expect((result as HelpError).message).toContain('--database')
  })

  test('validates database ID format', async () => {
    const result = await Bootstrap.new('prisma').parse(
      ['--api-key', 'test_key', '--database', 'invalid-id'],
      defaultTestConfig(),
      tmpDir,
    )
    expect(result).toBeInstanceOf(HelpError)
    expect((result as HelpError).message).toContain('db_')
  })

  test('rejects unknown --template name', async () => {
    const result = await Bootstrap.new('prisma').parse(
      ['--api-key', 'test_key', '--database', 'db_abc123', '--template', 'unknown-framework'],
      defaultTestConfig(),
      tmpDir,
    )
    expect(result).toBeInstanceOf(HelpError)
    expect((result as HelpError).message).toContain('Unknown template')
  })
})

describe('Bootstrap command — new project flow', () => {
  test.each([
    { args: [], templateFailure: false },
    { args: ['--template', 'nextjs'], templateFailure: true },
  ])('uses the scoped package in empty-project prisma7 recovery', async ({ args, templateFailure }) => {
    const { confirm } = await import('@inquirer/prompts')
    vi.mocked(confirm).mockResolvedValue(false)

    if (templateFailure) {
      const { downloadAndExtractTemplate } = await import('../template-scaffold')
      vi.mocked(downloadAndExtractTemplate).mockRejectedValueOnce(new Error('Network error'))
    }

    const result = await Bootstrap.new('prisma7').parse(
      ['--api-key', 'test_key', '--database', 'db_abc123', ...args],
      defaultTestConfig(),
      tmpDir,
    )

    expect(result).toBeInstanceOf(HelpError)
    expect((result as HelpError).message).toContain('npx @prisma/prisma7@latest bootstrap')
    expect((result as HelpError).message).not.toContain('npx prisma7 bootstrap')
  })

  test('runs init when user declines template, then links', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}', 'utf-8')
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'dotenv'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'prisma'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '@prisma', 'client'), { recursive: true })

    const { confirm } = await import('@inquirer/prompts')
    vi.mocked(confirm).mockResolvedValue(false)

    setupMockApiSuccess()

    const result = await Bootstrap.new('prisma').parse(
      ['--api-key', 'test_key', '--database', 'db_abc123'],
      defaultTestConfig(),
      tmpDir,
    )

    expect(result).not.toBeInstanceOf(Error)
    const output = result as string
    expect(output).toContain('Bootstrap completed')
    expect(output).toContain('Init')
  })

  test('scaffolds template when --template flag is provided', async () => {
    const { confirm } = await import('@inquirer/prompts')
    vi.mocked(confirm).mockResolvedValue(false)

    const { downloadAndExtractTemplate, installDependencies } = await import('../template-scaffold')

    setupMockApiSuccess()

    const result = await Bootstrap.new('prisma').parse(
      ['--api-key', 'test_key', '--database', 'db_abc123', '--template', 'nextjs'],
      defaultTestConfig(),
      tmpDir,
    )

    expect(result).not.toBeInstanceOf(Error)
    const output = result as string
    expect(output).toContain('Bootstrap completed')
    expect(output).toContain('Template')
    expect(output).toContain('done')
    expect(downloadAndExtractTemplate).toHaveBeenCalledWith('nextjs', tmpDir)
    expect(installDependencies).toHaveBeenCalledWith(tmpDir)
  })

  test('falls back to init when template download fails', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}', 'utf-8')
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'dotenv'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'prisma'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '@prisma', 'client'), { recursive: true })

    const { confirm } = await import('@inquirer/prompts')
    vi.mocked(confirm).mockResolvedValue(false)

    const { downloadAndExtractTemplate } = await import('../template-scaffold')
    vi.mocked(downloadAndExtractTemplate).mockRejectedValueOnce(new Error('Network error'))

    setupMockApiSuccess()

    const result = await Bootstrap.new('prisma').parse(
      ['--api-key', 'test_key', '--database', 'db_abc123', '--template', 'nextjs'],
      defaultTestConfig(),
      tmpDir,
    )

    expect(result).not.toBeInstanceOf(Error)
    const output = result as string
    expect(output).toContain('Bootstrap completed')
    expect(output).toContain('Template')
    expect(output).toContain('failed')
    expect(output).toContain('Init')
  })

  test('shows user-friendly message on template download timeout', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}', 'utf-8')
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'dotenv'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'prisma'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '@prisma', 'client'), { recursive: true })

    const { confirm } = await import('@inquirer/prompts')
    vi.mocked(confirm).mockResolvedValue(false)

    const { downloadAndExtractTemplate } = await import('../template-scaffold')
    const timeoutError = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    vi.mocked(downloadAndExtractTemplate).mockRejectedValueOnce(timeoutError)

    setupMockApiSuccess()

    const result = await Bootstrap.new('prisma').parse(
      ['--api-key', 'test_key', '--database', 'db_abc123', '--template', 'nextjs'],
      defaultTestConfig(),
      tmpDir,
    )

    expect(result).not.toBeInstanceOf(Error)
    const output = result as string
    expect(output).toContain('Bootstrap completed')
    expect(output).toContain('Template')
    expect(output).toContain('failed')
  })
})

describe('Bootstrap command — existing project flow', () => {
  test('uses the selected local CLI binary for migrate and generate on Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')

    const prismaDir = path.join(tmpDir, 'prisma')
    fs.mkdirSync(prismaDir, { recursive: true })
    fs.writeFileSync(
      path.join(prismaDir, 'schema.prisma'),
      'datasource db { provider = "postgresql" }\nmodel User { id Int @id }',
      'utf-8',
    )
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}', 'utf-8')
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '.bin'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'node_modules', '.bin', 'prisma7.cmd'), '', 'utf-8')
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'dotenv'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '@prisma', 'prisma7'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '@prisma', 'client'), { recursive: true })

    const { confirm } = await import('@inquirer/prompts')
    vi.mocked(confirm).mockResolvedValue(true)

    setupMockApiSuccess()

    const result = await Bootstrap.new('prisma7').parse(
      ['--api-key', 'test_key', '--database', 'db_abc123'],
      defaultTestConfig(),
      tmpDir,
    )

    expect(result).not.toBeInstanceOf(Error)
    expect(execFileSync).toHaveBeenCalledWith(
      path.join(tmpDir, 'node_modules', '.bin', 'prisma7.cmd'),
      ['migrate', 'dev', '--name', 'init'],
      expect.objectContaining({ cwd: tmpDir, shell: true, stdio: 'inherit' }),
    )
    expect(execFileSync).toHaveBeenCalledWith(
      path.join(tmpDir, 'node_modules', '.bin', 'prisma7.cmd'),
      ['generate'],
      expect.objectContaining({ cwd: tmpDir, shell: true, stdio: 'inherit' }),
    )
  })

  test('skips init and template when schema already exists', async () => {
    const prismaDir = path.join(tmpDir, 'prisma')
    fs.mkdirSync(prismaDir, { recursive: true })
    fs.writeFileSync(path.join(prismaDir, 'schema.prisma'), 'datasource db { provider = "postgresql" }', 'utf-8')
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'dotenv'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'prisma'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '@prisma', 'client'), { recursive: true })

    const { confirm } = await import('@inquirer/prompts')
    vi.mocked(confirm).mockResolvedValue(false)

    setupMockApiSuccess()

    const result = await Bootstrap.new('prisma').parse(
      ['--api-key', 'test_key', '--database', 'db_abc123'],
      defaultTestConfig(),
      tmpDir,
    )

    expect(result).not.toBeInstanceOf(Error)
    const output = result as string
    expect(output).toContain('Bootstrap completed')
    expect(output).toContain('Init')
  })
})

describe('Bootstrap command — consent gates', () => {
  test('skips migrate when user declines', async () => {
    const prismaDir = path.join(tmpDir, 'prisma')
    fs.mkdirSync(prismaDir, { recursive: true })
    fs.writeFileSync(
      path.join(prismaDir, 'schema.prisma'),
      `
datasource db { provider = "postgresql" }
model User { id Int @id }
`,
      'utf-8',
    )
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'dotenv'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'prisma'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '@prisma', 'client'), { recursive: true })

    const { confirm } = await import('@inquirer/prompts')
    vi.mocked(confirm).mockResolvedValue(false)

    setupMockApiSuccess()

    const result = await Bootstrap.new('prisma').parse(
      ['--api-key', 'test_key', '--database', 'db_abc123'],
      defaultTestConfig(),
      tmpDir,
    )

    expect(result).not.toBeInstanceOf(Error)
    const output = result as string
    expect(output).toContain('skipped')
  })
})

describe('Bootstrap command — deps gate', () => {
  test('prompts to install missing deps and continues when accepted', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}', 'utf-8')
    const prismaDir = path.join(tmpDir, 'prisma')
    fs.mkdirSync(prismaDir, { recursive: true })
    fs.writeFileSync(
      path.join(prismaDir, 'schema.prisma'),
      'datasource db { provider = "postgresql" }\nmodel User { id Int @id }',
      'utf-8',
    )

    const { confirm } = await import('@inquirer/prompts')
    vi.mocked(confirm).mockResolvedValue(true)

    const { addDependencies, addDevDependencies } = await import('../template-scaffold')
    vi.mocked(addDependencies).mockImplementation((_baseDir, _pkgs) => {
      fs.mkdirSync(path.join(tmpDir, 'node_modules', '@prisma', 'client'), { recursive: true })
      return Promise.resolve()
    })
    vi.mocked(addDevDependencies).mockImplementation((_baseDir, _pkgs) => {
      fs.mkdirSync(path.join(tmpDir, 'node_modules', 'dotenv'), { recursive: true })
      fs.mkdirSync(path.join(tmpDir, 'node_modules', 'prisma'), { recursive: true })
      return Promise.resolve()
    })

    setupMockApiSuccess()

    const result = await Bootstrap.new('prisma').parse(
      ['--api-key', 'test_key', '--database', 'db_abc123'],
      defaultTestConfig(),
      tmpDir,
    )

    expect(result).not.toBeInstanceOf(Error)
    const output = result as string
    expect(output).toContain('Bootstrap completed')
    expect(addDependencies).toHaveBeenCalledWith(tmpDir, ['@prisma/client'])
    expect(addDevDependencies).toHaveBeenCalledWith(tmpDir, ['dotenv', 'prisma'])
  })

  test('stops with install instructions when user declines deps install', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}', 'utf-8')
    const prismaDir = path.join(tmpDir, 'prisma')
    fs.mkdirSync(prismaDir, { recursive: true })
    fs.writeFileSync(
      path.join(prismaDir, 'schema.prisma'),
      'datasource db { provider = "postgresql" }\nmodel User { id Int @id }',
      'utf-8',
    )

    const { confirm } = await import('@inquirer/prompts')
    vi.mocked(confirm).mockReset()
    vi.mocked(confirm).mockResolvedValueOnce(false) // deps install — decline

    const { addDependencies, addDevDependencies } = await import('../template-scaffold')
    vi.mocked(addDependencies).mockReset()
    vi.mocked(addDevDependencies).mockReset()

    setupMockApiSuccess()

    const result = await Bootstrap.new('prisma').parse(
      ['--api-key', 'test_key', '--database', 'db_abc123'],
      defaultTestConfig(),
      tmpDir,
    )

    expect(result).not.toBeInstanceOf(Error)
    const output = result as string
    expect(output).toContain('Bootstrap completed')
    expect(addDependencies).not.toHaveBeenCalled()
    expect(addDevDependencies).not.toHaveBeenCalled()
  })

  test('skips deps gate when deps are installed', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}', 'utf-8')
    const prismaDir = path.join(tmpDir, 'prisma')
    fs.mkdirSync(prismaDir, { recursive: true })
    fs.writeFileSync(
      path.join(prismaDir, 'schema.prisma'),
      'datasource db { provider = "postgresql" }\nmodel User { id Int @id }',
      'utf-8',
    )

    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'dotenv'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'prisma'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '@prisma', 'client'), { recursive: true })

    const { confirm } = await import('@inquirer/prompts')
    vi.mocked(confirm).mockResolvedValue(true)

    setupMockApiSuccess()

    const result = await Bootstrap.new('prisma').parse(
      ['--api-key', 'test_key', '--database', 'db_abc123'],
      defaultTestConfig(),
      tmpDir,
    )

    expect(result).not.toBeInstanceOf(Error)
    const output = result as string
    expect(output).toContain('Bootstrap completed')
    expect(output).not.toContain('Re-run')
    expect(output).toContain('Migration')
  })
})

describe('Bootstrap command — seed step', () => {
  test('runs seed when seed script exists and user accepts', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      '{"name":"test","prisma":{"seed":"npx tsx prisma/seed.ts"}}',
      'utf-8',
    )
    const prismaDir = path.join(tmpDir, 'prisma')
    fs.mkdirSync(prismaDir, { recursive: true })
    fs.writeFileSync(
      path.join(prismaDir, 'schema.prisma'),
      'datasource db { provider = "postgresql" }\nmodel User { id Int @id }',
      'utf-8',
    )

    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'dotenv'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'prisma'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '@prisma', 'client'), { recursive: true })

    const { confirm } = await import('@inquirer/prompts')
    vi.mocked(confirm).mockResolvedValue(true)

    setupMockApiSuccess()

    const result = await Bootstrap.new('prisma').parse(
      ['--api-key', 'test_key', '--database', 'db_abc123'],
      defaultTestConfig(),
      tmpDir,
    )

    expect(result).not.toBeInstanceOf(Error)
    const output = result as string
    expect(output).toMatch(/Seed\s+done/)
  })

  test('skips seed when user declines', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      '{"name":"test","prisma":{"seed":"npx tsx prisma/seed.ts"}}',
      'utf-8',
    )
    const prismaDir = path.join(tmpDir, 'prisma')
    fs.mkdirSync(prismaDir, { recursive: true })
    fs.writeFileSync(
      path.join(prismaDir, 'schema.prisma'),
      'datasource db { provider = "postgresql" }\nmodel User { id Int @id }',
      'utf-8',
    )

    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'dotenv'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'prisma'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '@prisma', 'client'), { recursive: true })

    const { confirm } = await import('@inquirer/prompts')
    vi.mocked(confirm)
      .mockResolvedValueOnce(true) // migrate
      .mockResolvedValueOnce(false) // seed

    setupMockApiSuccess()

    const result = await Bootstrap.new('prisma').parse(
      ['--api-key', 'test_key', '--database', 'db_abc123'],
      defaultTestConfig(),
      tmpDir,
    )

    expect(result).not.toBeInstanceOf(Error)
    const output = result as string
    expect(output).toContain('Seed')
    expect(output).toContain('skipped')
  })
})

describe('Bootstrap command — mixed consent gates', () => {
  test('accepts migration but declines seed', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      '{"name":"test","prisma":{"seed":"npx tsx prisma/seed.ts"}}',
      'utf-8',
    )
    const prismaDir = path.join(tmpDir, 'prisma')
    fs.mkdirSync(prismaDir, { recursive: true })
    fs.writeFileSync(
      path.join(prismaDir, 'schema.prisma'),
      'datasource db { provider = "postgresql" }\nmodel User { id Int @id }',
      'utf-8',
    )

    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'dotenv'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'prisma'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '@prisma', 'client'), { recursive: true })

    const { confirm } = await import('@inquirer/prompts')
    vi.mocked(confirm)
      .mockResolvedValueOnce(true) // migrate
      .mockResolvedValueOnce(false) // seed

    setupMockApiSuccess()

    const result = await Bootstrap.new('prisma').parse(
      ['--api-key', 'test_key', '--database', 'db_abc123'],
      defaultTestConfig(),
      tmpDir,
    )

    expect(result).not.toBeInstanceOf(Error)
    const output = result as string
    expect(output).toContain('Migration')
    expect(output).toContain('done')
    expect(output).toContain('Seed')
    expect(output).toContain('skipped')
  })

  test('declines migration but accepts seed', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      '{"name":"test","prisma":{"seed":"npx tsx prisma/seed.ts"}}',
      'utf-8',
    )
    const prismaDir = path.join(tmpDir, 'prisma')
    fs.mkdirSync(prismaDir, { recursive: true })
    fs.writeFileSync(
      path.join(prismaDir, 'schema.prisma'),
      'datasource db { provider = "postgresql" }\nmodel User { id Int @id }',
      'utf-8',
    )

    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'dotenv'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'prisma'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '@prisma', 'client'), { recursive: true })

    const { confirm } = await import('@inquirer/prompts')
    vi.mocked(confirm)
      .mockResolvedValueOnce(false) // migrate
      .mockResolvedValueOnce(true) // seed

    setupMockApiSuccess()

    const result = await Bootstrap.new('prisma').parse(
      ['--api-key', 'test_key', '--database', 'db_abc123'],
      defaultTestConfig(),
      tmpDir,
    )

    expect(result).not.toBeInstanceOf(Error)
    const output = result as string
    expect(output).toContain('Migration')
    expect(output).toContain('skipped')
    expect(output).toContain('Seed')
  })
})

describe('Bootstrap command — error handling', () => {
  test('returns error on API failure', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}', 'utf-8')

    mockSdkClient.POST.mockResolvedValueOnce({
      data: undefined,
      error: { error: { code: 'unauthorized', message: 'Unauthorized' } },
    })

    const result = await Bootstrap.new('prisma').parse(
      ['--api-key', 'bad_key', '--database', 'db_abc123'],
      defaultTestConfig(),
      tmpDir,
    )

    expect(result).toBeInstanceOf(HelpError)
    expect((result as HelpError).message).toContain('Invalid credentials')
  })
})
