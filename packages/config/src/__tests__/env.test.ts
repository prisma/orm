import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { env, PrismaConfigEnvError } from '../env'

const VAR_NAME = 'PRISMA_CONFIG_ENV_TEST'
const originalValue = process.env[VAR_NAME]

describe('env', () => {
  beforeEach(() => {
    delete process.env[VAR_NAME]
  })

  afterAll(() => {
    if (originalValue === undefined) {
      delete process.env[VAR_NAME]
    } else {
      process.env[VAR_NAME] = originalValue
    }
  })

  test('returns the value when the environment variable is defined', () => {
    process.env[VAR_NAME] = 'postgresql://example'
    expect(env(VAR_NAME)).toBe('postgresql://example')
  })

  test('throws when the environment variable is missing', () => {
    expect(() => env(VAR_NAME)).toThrowError(PrismaConfigEnvError)
    expect(() => env(VAR_NAME)).toThrowErrorMatchingInlineSnapshot(
      `[PrismaConfigEnvError: Cannot resolve environment variable: PRISMA_CONFIG_ENV_TEST.]`,
    )
  })

  test('throws when the environment variable is an empty string', () => {
    process.env[VAR_NAME] = ''
    expect(() => env(VAR_NAME)).toThrowError(PrismaConfigEnvError)
    expect(() => env(VAR_NAME)).toThrowErrorMatchingInlineSnapshot(
      `[PrismaConfigEnvError: Cannot resolve environment variable: PRISMA_CONFIG_ENV_TEST.]`,
    )
  })
})
