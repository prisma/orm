import { expect, test } from 'vitest'

import { createDefaultRegistry, defaultRegistry } from './default'

test('default generators', () => {
  const generators = defaultRegistry.toInternal()

  expect(Object.keys(generators)).toEqual(['prisma-client-js', 'prisma-client-ts', 'prisma-client'])
  expect(generators['prisma-client']).toStrictEqual(generators['prisma-client-ts'])
})

test('createDefaultRegistry creates the same providers', () => {
  const generators = createDefaultRegistry('prisma7').toInternal()

  expect(Object.keys(generators)).toEqual(['prisma-client-js', 'prisma-client-ts', 'prisma-client'])
  expect(generators['prisma-client']).toStrictEqual(generators['prisma-client-ts'])
})
