import { expect, test } from 'vitest'

import { addProperty } from './addProperty'
import { createCompositeProxy } from './createCompositeProxy'

test('allows to add a property to a composite proxy', () => {
  const target = { first: 1 }
  const proxy = createCompositeProxy(target, [addProperty('second', () => 2)])

  expect(Object.keys(proxy)).toEqual(['first', 'second'])
  expect(proxy).toHaveProperty('second', 2)
})
