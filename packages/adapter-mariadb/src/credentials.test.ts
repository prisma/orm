import { clearLogs, getLogs } from '@prisma/debug'
import { beforeEach, describe, expect, test } from 'vitest'

import { PrismaMariaDbAdapterFactory } from './mariadb'

// A connection string with a port but no host. `new URL()` rejects it with an `ERR_INVALID_URL`
// carrying the whole string in `error.input`, and the mariadb driver then echoes the whole string
// back in its own error message.
const secretPassword = 'super_secret_password_12345'
const connectionString = `mariadb://user:${secretPassword}@:3306/db`

describe('credential sanitization', () => {
  beforeEach(() => {
    clearLogs()
  })

  test('connection string parse error should not expose password', async () => {
    const factory = new PrismaMariaDbAdapterFactory(connectionString)

    await expect(factory.connect()).rejects.toThrow()
    await expect(factory.connect()).rejects.not.toThrow(secretPassword)
  })

  test('connection string parse error should not expose password in debug logs', () => {
    new PrismaMariaDbAdapterFactory(connectionString)

    // The debug history is recorded whether or not `DEBUG` is set, and `getLogs()` embeds it in
    // user-facing error reports, so a leak here reaches users who never enabled debug output.
    expect(getLogs()).not.toContain(secretPassword)
  })
})
