import { NewPrismaClient } from '../../_utils/types'
import testMatrix from './_matrix'
// @ts-ignore
import { PrismaClient } from './generated/prisma/client'

declare const newPrismaClient: NewPrismaClient<PrismaClient, typeof PrismaClient>

testMatrix.setupTestSuite(
  () => {
    test('instantiate works without failing', () => {
      newPrismaClient({})
    })
  },
  {
    skipDefaultClientInstance: true,
    skipDb: true,
    skip(when, { clientEngineExecutor }) {
      when(
        clientEngineExecutor === 'remote',
        `
        Fails because it expects a driver adapter when there's no Accelerate URL.
        `,
      )
    },
  },
)
