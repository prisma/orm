import { defaultTestConfig } from '@prisma/config'
import { describe, expect, test, vi } from 'vitest'

import { PostgresCommand } from '../PostgresCommand'

describe('PostgresCommand', () => {
  test('shows help with no arguments', async () => {
    const cmd = PostgresCommand.new({}, 'prisma')
    const result = await cmd.parse([], defaultTestConfig(), '/tmp')
    expect(result).toContain('prisma postgres')
    expect(result).toContain('link')
  })

  test('shows help with --help flag', async () => {
    const cmd = PostgresCommand.new({}, 'prisma')
    const result = await cmd.parse(['--help'], defaultTestConfig(), '/tmp')
    expect(result).toContain('prisma postgres')
  })

  test('dispatches to subcommand', async () => {
    const mockLink = {
      parse: vi.fn().mockResolvedValue('link output'),
    }
    const cmd = PostgresCommand.new({ link: mockLink }, 'prisma')
    const config = defaultTestConfig()
    const result = await cmd.parse(['link', '--api-key', 'test_key'], config, '/tmp')

    expect(result).toBe('link output')
    expect(mockLink.parse).toHaveBeenCalledWith(['--api-key', 'test_key'], config, '/tmp')
  })

  test('returns error for unknown subcommand', async () => {
    const cmd = PostgresCommand.new({}, 'prisma')
    const result = await cmd.parse(['unknown'], defaultTestConfig(), '/tmp')
    expect(result).toBeInstanceOf(Error)
  })
})
