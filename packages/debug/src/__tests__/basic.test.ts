import { stripVTControlCharacters } from 'node:util'

import { describe, expect, test } from 'vitest'

import { Debug, getLogs } from '../index'
import { removeISODate, sanitizeTestLogs } from '../util'

describe('debug', () => {
  test('should not log if it is not enabled', () => {
    const debug = Debug('my-namespace')
    const logs: string[] = []

    debug.log = (...args) => {
      logs.push(stripVTControlCharacters(`${args[0]}${args[1]}`).trim())
    }

    debug('Does it even log?')
    debug('I dont know')

    expect(removeISODate(JSON.stringify(logs, null, 2))).toMatchInlineSnapshot(`"[]"`)

    expect(sanitizeTestLogs(getLogs())).toMatchInlineSnapshot(`
      "my-namespace Does it even log?
      my-namespace I dont know"
    `)
  })

  test('should log if its enabled', () => {
    const debug = Debug('a-namespace')
    const logs: string[] = []

    Debug.enable('a-namespace')

    debug.log = (...args) => {
      logs.push(stripVTControlCharacters(`${args[0]} ${args[1]}`).trim())
    }

    debug('Does it even log?')
    debug('I dont know')

    expect(removeISODate(JSON.stringify(logs, null, 2))).toMatchInlineSnapshot(`
      "[
        "a-namespace Does it even log?",
        "a-namespace I dont know"
      ]"
    `)

    expect(sanitizeTestLogs(getLogs())).toMatchInlineSnapshot(`
      "my-namespace Does it even log?
      my-namespace I dont know
      a-namespace Does it even log?
      a-namespace I dont know"
    `)
  })
})
