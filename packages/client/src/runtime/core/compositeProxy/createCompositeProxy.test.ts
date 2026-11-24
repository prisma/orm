import util from 'node:util'

import { expect, test, vi } from 'vitest'

import { createCompositeProxy } from './createCompositeProxy'

test('forwards properties to the target', () => {
  const target = { foo: 'bar' }
  const proxy = createCompositeProxy(target, [])

  expect(proxy.foo).toBe('bar')
})

test('allows to set property', () => {
  const proxy = createCompositeProxy({} as Record<string, unknown>, [])

  proxy.foo = 1

  expect(Object.keys(proxy)).toEqual(['foo'])
  expect(proxy.foo).toBe(1)
})

test('allows to add extra properties via layers', () => {
  const proxy = createCompositeProxy({ first: 1 }, [
    {
      getKeys() {
        return ['second']
      },

      getPropertyValue() {
        return 2
      },
    },
  ])

  expect(Object.keys(proxy)).toEqual(['first', 'second'])
  expect(proxy).toHaveProperty('first', 1)
  expect(proxy).toHaveProperty('second', 2)
})

test('preserves correct Object.prototype.hasOwnProperty result', () => {
  const proxy = createCompositeProxy({}, [])
  expect(Object.prototype.hasOwnProperty.call(proxy, 'notThere')).toBe(false)
})

test('allows to add multiple properties via single layer', () => {
  const proxy = createCompositeProxy({}, [
    {
      getKeys() {
        return ['first', 'second']
      },

      getPropertyValue(key) {
        return key === 'first' ? 1 : 2
      },
    },
  ])

  expect(Object.keys(proxy)).toEqual(['first', 'second'])
  expect(proxy).toHaveProperty('first', 1)
  expect(proxy).toHaveProperty('second', 2)
})

test('logs proxy properties if used in console.log/util.inspect', () => {
  const proxy = createCompositeProxy({}, [
    {
      getKeys() {
        return ['first', 'second']
      },

      getPropertyValue(key) {
        return key === 'first' ? 1 : 2
      },
    },
  ])

  expect(util.inspect(proxy)).toMatchInlineSnapshot(`"{ first: 1, second: 2 }"`)
})

test('allows to set property descriptor via layer', () => {
  const proxy = createCompositeProxy({}, [
    {
      getKeys() {
        return ['first', 'second']
      },

      getPropertyValue() {
        return 123
      },

      getPropertyDescriptor(key) {
        if (key === 'first') {
          return {
            writable: true,
            configurable: true,
            enumerable: false,
          }
        }
        return undefined
      },
    },
  ])

  expect(Object.keys(proxy)).toEqual(['second'])
  expect(proxy).toHaveProperty('first', 123)
  expect(proxy).toHaveProperty('second', 123)
})

test('allows to hide properties via layers', () => {
  const proxy = createCompositeProxy({ prop: 1, secret: "It's a secret to everybody" }, [
    {
      getKeys() {
        return ['secret']
      },

      getPropertyValue() {
        return undefined
      },

      has() {
        return false
      },
    },
  ])

  expect(Object.keys(proxy)).toEqual(['prop'])
  expect('secret' in proxy).toBe(false)
  expect(proxy['secret']).toBeUndefined()
})

test('does not add layers for undeclared keys', () => {
  const getPropertyValue = vi.fn()
  const proxy = createCompositeProxy({} as Record<string, unknown>, [
    {
      getKeys() {
        return ['first']
      },

      getPropertyValue,
    },
  ])

  expect(proxy.third).toBeUndefined()
  expect(getPropertyValue).not.toHaveBeenCalled()
})

test('allows to have several layers', () => {
  const proxy = createCompositeProxy({ first: 1 }, [
    {
      getKeys() {
        return ['second']
      },

      getPropertyValue() {
        return 2
      },
    },
    {
      getKeys() {
        return ['third']
      },

      getPropertyValue() {
        return 3
      },
    },
  ])

  expect(Object.keys(proxy)).toEqual(['first', 'second', 'third'])
  expect(proxy).toHaveProperty('first', 1)
  expect(proxy).toHaveProperty('second', 2)
  expect(proxy).toHaveProperty('third', 3)
})

test('allows to override target property', () => {
  const proxy = createCompositeProxy({ value: 'original' }, [
    {
      getKeys() {
        return ['value']
      },

      getPropertyValue() {
        return 'override'
      },
    },
  ])

  expect(proxy).toHaveProperty('value', 'override')
})

test('last override wins', () => {
  const proxy = createCompositeProxy({ value: 'original' }, [
    {
      getKeys() {
        return ['value']
      },

      getPropertyValue() {
        return 'override 1'
      },
    },

    {
      getKeys() {
        return ['value']
      },

      getPropertyValue() {
        return 'override 2'
      },
    },
  ])

  expect(proxy).toHaveProperty('value', 'override 2')
})

test('recalculates property on every access', () => {
  let counter = 0
  const proxy = createCompositeProxy({} as Record<string, number>, [
    {
      getKeys() {
        return ['prop']
      },

      getPropertyValue() {
        return counter++
      },
    },
  ])

  expect(proxy.prop).toBe(0)
  expect(proxy.prop).toBe(1)
  expect(proxy.prop).toBe(2)
})

test('allows to override a property from a layer', () => {
  const target = {} as Record<string, unknown>

  const proxy = createCompositeProxy(target, [
    {
      getKeys() {
        return ['prop']
      },

      getPropertyValue() {
        return 'from proxy'
      },
    },
  ])

  proxy.prop = 'override'

  expect(target.prop).toBe('override')
  expect(proxy.prop).toBe('override')
})

test('allows to override a property from a layer using defineProperty', () => {
  const target = {} as Record<string, unknown>

  const proxy = createCompositeProxy(target, [
    {
      getKeys() {
        return ['prop']
      },

      getPropertyValue() {
        return 'from proxy'
      },
    },
  ])

  Object.defineProperty(proxy, 'prop', {
    value: 'override',
  })

  expect(target.prop).toBe('override')
  expect(proxy.prop).toBe('override')
})

test('does not allow to overriding property from a layer if it is non writable', () => {
  const target = {} as Record<string, unknown>

  const proxy = createCompositeProxy(target, [
    {
      getKeys() {
        return ['prop']
      },

      getPropertyValue() {
        return 'from proxy'
      },

      getPropertyDescriptor() {
        return {
          writable: false,
          configurable: false,
        }
      },
    },
  ])

  expect(() => {
    proxy.prop = 'override'
  }).toThrow()

  expect(target.prop).toBeUndefined()
  expect(proxy.prop).toBe('from proxy')
})
