import testMatrix from './_matrix'
// @ts-ignore
import type { Prisma as PrismaNamespace } from './generated/prisma/client'

declare let Prisma: typeof PrismaNamespace

testMatrix.setupTestSuite(
  ({ generatorType }) => {
    describeIf(generatorType === 'prisma-client-js')('Prisma.dmmf in JS client', () => {
      test('exports Prisma.dmmf (default)', () => {
        expect(Prisma.dmmf).toMatchSnapshot()
      })
    })
  },
  {
    skipDb: true,
    skipDefaultClientInstance: true,
  },
)
