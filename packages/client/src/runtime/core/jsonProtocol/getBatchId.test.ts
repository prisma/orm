import { expect, test } from 'vitest'

import { getBatchId } from './getBatchId'

test('getBatchId for findMany', () => {
  expect(
    getBatchId({
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          where: {
            id: '123',
          },
        },
        selection: {
          $composites: true,
          $scalars: true,
        },
      },
    }),
  ).toBeUndefined()
})

test('getBatchId for findUnique', () => {
  expect(
    getBatchId({
      modelName: 'User',
      action: 'findUnique',
      query: {
        arguments: {
          where: {
            id: '123',
          },
        },
        selection: {
          $composites: true,
          $scalars: true,
        },
      },
    }),
  ).toMatchInlineSnapshot(`"User((where (id)))($composites $scalars)"`)
})

test('getBatchId for findUniqueOrThrow', () => {
  expect(
    getBatchId({
      modelName: 'User',
      action: 'findUniqueOrThrow',
      query: {
        arguments: {
          where: {
            id: '123',
          },
        },
        selection: {
          $composites: true,
          $scalars: true,
        },
      },
    }),
  ).toMatchInlineSnapshot(`"User((where (id)))($composites $scalars)"`)
})
