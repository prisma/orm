import { expect, test } from 'vitest'

import { mergeBy } from '../runtime/mergeBy'

test('basic mergeBy', () => {
  const arr1 = [
    {
      name: 'db',
      url: 'file:old-url.db',
    },
  ]
  const arr2 = [
    {
      name: 'db',
      url: 'file:new-url.db',
    },
  ]
  expect(mergeBy(arr1, arr2, (a) => a.name)).toMatchInlineSnapshot(`
    [
      {
        "name": "db",
        "url": "file:new-url.db",
      },
    ]
  `)
})

test('mergeBy should merge last item', () => {
  const arr1 = [
    {
      name: 'db',
      url: 'file:old-url.db',
    },
  ]
  const arr2 = [
    {
      name: 'db',
      url: 'file:new-url.db',
    },
    {
      name: 'db',
      url: 'file:new-url2.db',
    },
  ]
  expect(mergeBy(arr1, arr2, (a) => a.name)).toMatchInlineSnapshot(`
    [
      {
        "name": "db",
        "url": "file:new-url2.db",
      },
    ]
  `)
})
