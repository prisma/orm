import { expect, test } from 'vitest'

import { addObjectProperties } from './addObjectProperties'
import { createCompositeProxy } from './createCompositeProxy'

test('forwards properties to a target object', () => {
  const target = { first: 1 }
  const extensions = { second: 2, third: 3 }

  const proxy = createCompositeProxy(target, [addObjectProperties(extensions)])

  expect(Object.keys(proxy)).toEqual(['first', 'second', 'third'])
  expect(proxy).toHaveProperty('first', 1)
  expect(proxy).toHaveProperty('second', 2)
  expect(proxy).toHaveProperty('third', 3)
})
