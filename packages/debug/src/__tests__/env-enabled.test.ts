import { stripVTControlCharacters } from 'node:util'

import { describe, expect, test } from 'vitest'

import { removeISODate, sanitizeTestLogs } from '../util'

describe('debug', () => {
  test('env vars work as expected', async () => {
    process.env.DEBUG = 'my-namespace'

    const { Debug, getLogs } = await import('../index')

    const debug = Debug('my-namespace')
    const logs: string[] = []

    debug.log = (...args) => {
      logs.push(stripVTControlCharacters(`${args[0]} ${args[1]}`).trim())
    }

    debug('Does it even log?')
    debug('I dont know')

    expect(removeISODate(JSON.stringify(logs, null, 2))).toMatchInlineSnapshot(`
      "[
        "my-namespace Does it even log?",
        "my-namespace I dont know"
      ]"
    `)

    expect(sanitizeTestLogs(getLogs())).toMatchInlineSnapshot(`
      "my-namespace Does it even log?
      my-namespace I dont know"
    `)
  })
})
