// @ts-ignore
import { NewPrismaClient } from '../_utils/types'
import testMatrix from './_matrix'
import type { PrismaClient } from './generated/prisma/client'

declare const newPrismaClient: NewPrismaClient<PrismaClient, typeof PrismaClient>

const TIMEOUT = 60_000

testMatrix.setupTestSuite(() => {
  const oldConsoleWarn = console.warn
  const warnings: any[] = []

  beforeAll(() => {
    jest.resetModules()

    console.warn = (args) => {
      warnings.push(args)
    }
  })

  afterAll(() => {
    console.warn = oldConsoleWarn
  })

  test(
    'should not console warn when spawning too many instances of PrismaClient',
    async () => {
      for (let i = 0; i < 15; i++) {
        const client = newPrismaClient({})
        await client.$connect()
      }

      expect(warnings.join('')).toMatchInlineSnapshot(`""`)
    },
    TIMEOUT,
  )
})
