// copied from the original debug tests
import { describe, it } from 'vitest'

import Debug from '../index'

const assert = require('assert')

it('passes a basic sanity check', () => {
  const log = Debug('test')
  log.enabled = true
  log.log = () => {}

  assert.doesNotThrow(() => log('hello world'))
})

it('allows namespaces to be a non-string value', () => {
  const log = Debug('test')
  log.enabled = true
  log.log = () => {}

  assert.doesNotThrow(() => Debug.enable(true))
})

it('honors global debug namespace enable calls', () => {
  assert.deepStrictEqual(Debug('test:12345').enabled, false)
  assert.deepStrictEqual(Debug('test:67890').enabled, false)

  Debug.enable('test:12345')
  assert.deepStrictEqual(Debug('test:12345').enabled, true)
  assert.deepStrictEqual(Debug('test:67890').enabled, false)
})

it('uses custom log function', () => {
  const log = Debug('test')
  log.enabled = true

  const messages = [] as any[]
  log.log = (...args) => messages.push(args)

  log('using custom log function')
  log('using custom log function again')
  log('%O', 12345)

  assert.deepStrictEqual(messages.length, 3)
})

describe('rebuild namespaces string (disable)', () => {
  it('handle names, skips, and wildcards', () => {
    Debug.enable('test,abc*,-abc')
    const namespaces = Debug.disable()
    assert.deepStrictEqual(namespaces, 'test,abc*,-abc')
  })

  it('handles empty', () => {
    Debug.enable('')
    const namespaces = Debug.disable()
    assert.deepStrictEqual(namespaces, '')
  })

  it('handles all', () => {
    Debug.enable('*')
    const namespaces = Debug.disable()
    assert.deepStrictEqual(namespaces, '*')
  })

  it('handles skip all', () => {
    Debug.enable('-*')
    const namespaces = Debug.disable()
    assert.deepStrictEqual(namespaces, '-*')
  })

  it('handles re-enabling existing instances', () => {
    Debug.disable()
    const inst = Debug('foo')
    const messages = [] as string[]
    // ! slight deviation here in Prisma, we pass the namespace as the first argument
    inst.log = (ns, msg) => messages.push(msg.replace(/^[^@]*@([^@]+)@.*$/, '$1'))

    inst('@test@')
    assert.deepStrictEqual(messages, [])
    Debug.enable('foo')
    assert.deepStrictEqual(messages, [])
    inst('@test2@')
    assert.deepStrictEqual(messages, ['test2'])
    inst('@test3@')
    assert.deepStrictEqual(messages, ['test2', 'test3'])
    Debug.disable()
    inst('@test4@')
    assert.deepStrictEqual(messages, ['test2', 'test3'])
  })
})
