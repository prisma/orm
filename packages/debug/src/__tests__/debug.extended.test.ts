import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import * as useDebugImport from '../index'

let Debug: typeof useDebugImport.default

const importDebug = async () => {
  const mod = await import('../index')
  Debug = mod.default
}

beforeEach(() => {
  delete process.env.DEBUG
  delete process.env.DEBUG_COLORS
  // @ts-ignore
  delete globalThis.DEBUG
  // @ts-ignore
  delete globalThis.DEBUG_COLORS
})

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

test('with a namespace', async () => {
  const consoleWarn = vi.spyOn(console, 'warn')

  process.env.DEBUG = 'test'
  process.env.DEBUG_COLORS = 'false'
  await importDebug()
  const debug = Debug('test')
  debug('hello world')

  const consoleWarnParams = consoleWarn.mock.calls.map(mapper)
  expect(consoleWarnParams[0][0]).toMatchInlineSnapshot(`"test hello world"`)
  expect(consoleWarnParams.length).toBe(1)
})

test('with colors', async () => {
  const consoleWarn = vi.spyOn(console, 'warn')

  process.env.DEBUG = 'test2'
  process.env.FORCE_COLOR = 'true'
  process.env.DEBUG_COLORS = 'true'
  await importDebug()
  const debug = Debug('test2')

  debug('hello world')

  const consoleWarnParams = consoleWarn.mock.calls.map(mapper)
  expect(consoleWarnParams[0][0]).toMatchInlineSnapshot(`"test2 hello world"`)
  expect(consoleWarnParams.length).toBe(1)
})

test('with multiple wild cards', async () => {
  const consoleWarn = vi.spyOn(console, 'warn')

  process.env.DEBUG = 'test3:*:*:*'
  process.env.DEBUG_COLORS = 'false'
  await importDebug()
  Debug('test3:client:query-engine:init')('match1')
  Debug('test3:client:query-engine')('match2')

  const consoleWarnParams = consoleWarn.mock.calls.map(mapper)
  expect(consoleWarnParams[0][0]).toMatchInlineSnapshot(`"test3:client:query-engine:init match1"`)
  expect(consoleWarnParams.length).toBe(1)
})

test('with multiple wild cards and filter', async () => {
  const consoleWarn = vi.spyOn(console, 'warn')

  process.env.DEBUG = 'test4:*:query-engine:*'
  process.env.DEBUG_COLORS = 'false'
  await importDebug()
  Debug('test4:client:query-engine:init')('match1')
  Debug('test4:client:query-engine')('match2')
  Debug('test4:pool:query-engine:delete')('match3')

  const consoleWarnParams = consoleWarn.mock.calls.map(mapper)
  expect(consoleWarnParams[0][0]).toMatchInlineSnapshot(`"test4:client:query-engine:init match1"`)
  expect(consoleWarnParams[1][0]).toMatchInlineSnapshot(`"test4:pool:query-engine:delete match3"`)
  expect(consoleWarnParams.length).toBe(2)
})

test('with trailing wild cards', async () => {
  const consoleWarn = vi.spyOn(console, 'warn')

  process.env.DEBUG = 'test5:*:*'
  process.env.DEBUG_COLORS = 'false'
  await importDebug()
  Debug('test5:client:query-engine:init')('match1')
  Debug('test5:client:query-engine')('match2')
  Debug('test5:pool:query-engine:delete')('match3')

  const consoleWarnParams = consoleWarn.mock.calls.map(mapper)
  expect(consoleWarnParams[0][0]).toMatchInlineSnapshot(`"test5:client:query-engine:init match1"`)
  expect(consoleWarnParams[1][0]).toMatchInlineSnapshot(`"test5:client:query-engine match2"`)
  expect(consoleWarnParams[2][0]).toMatchInlineSnapshot(`"test5:pool:query-engine:delete match3"`)
  expect(consoleWarnParams.length).toBe(3)
})

test('with trailing wild cards and filter', async () => {
  const consoleWarn = vi.spyOn(console, 'warn')

  process.env.DEBUG = 'test6:client:*'
  process.env.DEBUG_COLORS = 'false'
  await importDebug()
  Debug('test6:client:query-engine:init')('match1')
  Debug('test6:client:query-engine')('match2')
  Debug('test6:pool:query-engine:delete')('match3')

  const consoleWarnParams = consoleWarn.mock.calls.map(mapper)
  expect(consoleWarnParams[0][0]).toMatchInlineSnapshot(`"test6:client:query-engine:init match1"`)
  expect(consoleWarnParams[1][0]).toMatchInlineSnapshot(`"test6:client:query-engine match2"`)
  expect(consoleWarnParams.length).toBe(2)
})

test('with multiple wild cards and exclusion filter', async () => {
  const consoleWarn = vi.spyOn(console, 'warn')

  process.env.DEBUG = 'test7:*:*,-test7:*:*:init'
  process.env.DEBUG_COLORS = 'false'
  await importDebug()
  Debug('test7:client:query-engine:init')('match1')
  Debug('test7:client:query-engine')('match2')
  Debug('test7:pool:query-engine:delete')('match3')

  const consoleWarnParams = consoleWarn.mock.calls.map(mapper)
  expect(consoleWarnParams[0][0]).toMatchInlineSnapshot(`"test7:client:query-engine match2"`)
  expect(consoleWarnParams[1][0]).toMatchInlineSnapshot(`"test7:pool:query-engine:delete match3"`)
  expect(consoleWarnParams.length).toBe(2)
})

test('with multiple wild cards and multiple exclusion filters', async () => {
  const consoleWarn = vi.spyOn(console, 'warn')

  process.env.DEBUG = 'test8:*:*,-test8:*:*:init,-test8:pool:*'
  process.env.DEBUG_COLORS = 'false'
  await importDebug()
  Debug('test8:client:query-engine:init')('match1')
  Debug('test8:client:query-engine')('match2')
  Debug('test8:pool:query-engine:delete')('match3')

  const consoleWarnParams = consoleWarn.mock.calls.map(mapper)
  expect(consoleWarnParams[0][0]).toMatchInlineSnapshot(`"test8:client:query-engine match2"`)
  expect(consoleWarnParams.length).toBe(1)
})

test('truncation when no wildcard is used', async () => {
  const consoleWarn = vi.spyOn(console, 'warn')

  process.env.DEBUG = 'test9:client'
  process.env.DEBUG_COLORS = 'false'
  await importDebug()
  Debug('test9:client:query-engine:init')('match1')
  Debug('test9:client:query-engine')('match2')
  Debug('test9:pool:query-engine:delete')('match3')
  Debug('test9:client')('match4')

  const consoleWarnParams = consoleWarn.mock.calls.map(mapper)
  expect(consoleWarnParams[0][0]).toMatchInlineSnapshot(`"test9:client match4"`)
  expect(consoleWarnParams.length).toBe(1)
})

test('object serialization', async () => {
  const consoleWarn = vi.spyOn(console, 'warn')

  process.env.DEBUG = 'test10:client'
  process.env.DEBUG_COLORS = 'false'
  await importDebug()
  const object = { a: 1, b: { c: {}, d: {} } }
  object.b.c = object
  object.b.d = [object]
  Debug('test10:client')(object)

  const consoleWarnParams = consoleWarn.mock.calls.map(mapper)
  expect(consoleWarnParams[0][0]).toMatchInlineSnapshot(`
    "test10:client {
      "a": 1,
      "b": {
        "c": "[Circular *]",
        "d": [
          "[Circular *]"
        ]
      }
    }"
  `)
  expect(consoleWarnParams.length).toBe(1)
})

test('millisecond timestamps', async () => {
  const consoleWarn = vi.spyOn(console, 'warn')

  process.env.DEBUG = 'test11:client'
  process.env.DEBUG_COLORS = 'false'
  await importDebug()
  Debug('test11:client')('match1')

  const consoleWarnParams = consoleWarn.mock.calls.map(mapper)

  expect(consoleWarnParams[0][0]).toMatchInlineSnapshot(`"test11:client match1"`)
  expect(consoleWarnParams[0][1]?.match(/\+\d+ms/)).toBeTruthy()
  expect(consoleWarnParams.length).toBe(1)
})

test('wildcard can be used like a regex at the end', async () => {
  const consoleWarn = vi.spyOn(console, 'warn')

  process.env.DEBUG = 'test12:client*'
  process.env.DEBUG_COLORS = 'false'
  await importDebug()
  Debug('test12:client:query-engine:init')('match1')
  Debug('test12:client:query-engine')('match2')
  Debug('test12:pool:query-engine:delete')('match3')
  Debug('test12:client')('match4')

  const consoleWarnParams = consoleWarn.mock.calls.map(mapper)
  expect(consoleWarnParams[0][0]).toMatchInlineSnapshot(`"test12:client:query-engine:init match1"`)
  expect(consoleWarnParams[1][0]).toMatchInlineSnapshot(`"test12:client:query-engine match2"`)
  expect(consoleWarnParams[2][0]).toMatchInlineSnapshot(`"test12:client match4"`)
  expect(consoleWarnParams.length).toBe(3)
})

test('wildcard can be used like a regex in the middle', async () => {
  const consoleWarn = vi.spyOn(console, 'warn')

  process.env.DEBUG = 'test13:client*init'
  process.env.DEBUG_COLORS = 'false'
  await importDebug()
  Debug('test13:client:query-engine:init')('match1')
  Debug('test13:client:query-engine')('match2')
  Debug('test13:pool:query-engine:delete')('match3')
  Debug('test13:client')('match4')

  const consoleWarnParams = consoleWarn.mock.calls.map(mapper)
  expect(consoleWarnParams[0][0]).toMatchInlineSnapshot(`"test13:client:query-engine:init match1"`)
  expect(consoleWarnParams.length).toBe(1)
})

test('can manage complex inclusions and exclusions', async () => {
  const consoleWarn = vi.spyOn(console, 'warn')

  // Accepted alternatives:
  // - Anything that starts with 'test14:', followed by any number of characters, then ':query-engine:',
  //   with any number of characters after that.
  // - Anything that doesn't end with ':init'.
  // - Anything that ends with ':result'.
  process.env.DEBUG = 'test14:*:query-engine:*,-*init,*:result'
  process.env.DEBUG_COLORS = 'false'
  await importDebug()
  Debug('test14:client:query-engine:init')('match1')
  Debug('test14:client:query-engine')('match2')
  Debug('test14:pool:query-engine:delete')('match3')
  Debug('test14:client')('match4')
  Debug('test14:pool:query-engine:init')('match5')
  Debug('test14:psl:init')('match6')
  Debug('test14:psl:result')('match6')
  Debug('AAAA:psl:result')('match6')

  const consoleWarnParams = consoleWarn.mock.calls.map(mapper)
  expect(consoleWarnParams[0][0]).toMatchInlineSnapshot(`"test14:pool:query-engine:delete match3"`)
  expect(consoleWarnParams[1][0]).toMatchInlineSnapshot(`"test14:psl:result match6"`)
  expect(consoleWarnParams[2][0]).toMatchInlineSnapshot(`"AAAA:psl:result match6"`)
  expect(consoleWarnParams.length).toBe(3)
})

test('regex characters do not mess with matching', async () => {
  const consoleWarn = vi.spyOn(console, 'warn')

  process.env.DEBUG = 'test15:\\w+'
  process.env.DEBUG_COLORS = 'false'
  await importDebug()
  Debug('test15:hello')('match1')

  const consoleWarnParams = consoleWarn.mock.calls.map(mapper)
  expect(consoleWarnParams.length).toBe(0)
})

// utility to map the calls to the stderr mock this makes it easier to read
// snapshots and separates time diffs from the message logs
const mapper = (call: any[]) => {
  const [args, time] = call as [string, string]
  return [args, time]
}
