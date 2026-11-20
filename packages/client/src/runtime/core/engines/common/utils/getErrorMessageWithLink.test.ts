import { stripVTControlCharacters } from 'node:util'

import { expect, test } from 'vitest'

import { getErrorMessageWithLink } from './getErrorMessageWithLink'

test('basic serialization', () => {
  const message = getErrorMessageWithLink({
    binaryTarget: 'darwin',
    title: 'This is a title',
    version: '1.2.3',
    description: 'This is some crazy description',
    query: 'QUERY',
    database: 'mongodb',
    engineVersion: 'abcdefhg',
  })
  expect(
    stripVTControlCharacters(message)
      .replace(/v\d{1,2}\.\d{1,2}\.\d{1,2}/, 'NODE_VERSION')
      .replace(/[\+-]/g, '')
      .replace(/https:\/\/github.com\/prisma\/prisma\/issues\/new\S+/, 'TEST_GITHUB_LINK'),
  ).toMatchInlineSnapshot(`
    "This is a title

    This is a nonrecoverable error which probably happens when the Prisma Query Engine has a panic.

    TEST_GITHUB_LINK

    If you want the Prisma team to look into it, please open the link above 🙏
    To increase the chance of success, please post your schema and a snippet of
    how you used Prisma Client in the issue. 
    "
  `)
})
