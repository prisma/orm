import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { isInteractive } from '../isInteractive'

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

describe('isInteractive', () => {
  beforeEach(() => {
    restoreEnv()
  })
  afterAll(() => {
    restoreEnv()
  })

  describe('in non TTY environment', () => {
    const mockedValue = { isTTY: false } as NodeJS.ReadStream
    test('isInteractive should be false', () => {
      expect(isInteractive({ stream: mockedValue })).toBe(false)
    })

    test('isInteractive should be false if TERM = dumb', () => {
      process.env.TERM = 'dumb'
      expect(isInteractive({ stream: mockedValue })).toBe(false)
    })
  })

  describe('in TTY environment', () => {
    const mockedValue = { isTTY: true } as NodeJS.ReadStream
    test('isInteractive should be true', () => {
      expect(isInteractive({ stream: mockedValue })).toBe(true)
    })

    test('isInteractive should be false if TERM = dumb', () => {
      process.env.TERM = 'dumb'
      expect(isInteractive({ stream: mockedValue })).toBe(false)
    })
  })
})
