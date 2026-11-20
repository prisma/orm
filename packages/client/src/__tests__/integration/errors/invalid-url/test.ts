import { generateTestClient } from '../../../../utils/getTestClient'

let prisma

// TODO The error message surfaced here are actually slightly misleading: https://github.com/prisma/prisma/issues/21732
describe('invalid connection string url parameter', () => {
  beforeAll(async () => {
    await generateTestClient()
    const { PrismaClient } = require('./node_modules/@prisma/client')
    prisma = new PrismaClient()
  })

  test('should throw with auto-connect', async () => {
    expect.assertions(1)

    try {
      await prisma.user.findUnique({
        where: {
          email: 'a@a.de',
        },
      })
    } catch (err) {
      expect(err).toMatchInlineSnapshot(`

        Invalid \`prisma.user.findUnique()\` invocation in
        /client/src/__tests__/integration/errors/invalid-url/test.ts:0:0

          14 expect.assertions(1)
          15 
          16 try {
        → 17   await prisma.user.findUnique(
        The provided database string is invalid. The provided arguments are not supported in database URL. Please refer to the documentation in https://pris.ly/d/config-url for constructing a correct connection string. In some cases, certain characters must be escaped. Please check the string for any illegal characters.
      `)
    }
  })

  test('show through with explicit connect', async () => {
    expect.assertions(1)
    try {
      await prisma.$connect()
    } catch (err) {
      expect(err).toMatchInlineSnapshot(
        `The provided database string is invalid. The provided arguments are not supported in database URL. Please refer to the documentation in https://pris.ly/d/config-url for constructing a correct connection string. In some cases, certain characters must be escaped. Please check the string for any illegal characters.`,
      )
    }
  })
})
