import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { isCi } from '../isCi'

const originalEnv = { ...process.env }
const originalStdinisTTY = process.stdin.isTTY

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

describe('isCi', () => {
  beforeEach(() => {
    restoreEnv()
    process.stdin.isTTY = originalStdinisTTY
  })
  afterAll(() => {
    restoreEnv()
    process.stdin.isTTY = originalStdinisTTY
  })

  describe('in non TTY environment', () => {
    beforeEach(() => {
      delete process.env.GITHUB_ACTIONS
      delete process.env.CI
      process.stdin.isTTY = false
    })

    test('with undefined env vars, isCi should be false', () => {
      expect(isCi()).toBe(false)
    })
  })

  describe('in TTY environment', () => {
    beforeEach(() => {
      delete process.env.GITHUB_ACTIONS
      delete process.env.CI
      process.stdin.isTTY = true
    })

    test('with CI env var, isCi should be true', () => {
      process.env.CI = 'true'
      expect(isCi()).toBe(true)
    })

    test('with GitHub Actions env var, isCi should be true', () => {
      process.env.GITHUB_ACTIONS = 'true'
      expect(isCi()).toBe(true)
    })

    test('with undefined env vars, isCi should be false', () => {
      expect(isCi()).toBe(false)
    })
  })
})
