import { Providers } from '../../_utils/providers'
import testMatrix from './_matrix'

// @ts-ignore this is just for type checks
declare let prisma: import('./generated/prisma/client').PrismaClient

testMatrix.setupTestSuite(
  (_suiteConfig, _suiteMeta, _clientMeta, cliMeta) => {
    // Skipped because of https://github.com/prisma/prisma/issues/22971
    // `eventId String @map("event_id")` triggers the issue.
    describeIf(!cliMeta.previewFeatures.includes('relationJoins'))('issue 10000', () => {
      afterAll(async () => {
        await prisma.$disconnect()
      })

      test('issue 10000', async () => {
        const events = await prisma.event.create({
          data: {
            id: 'prisma',
            name: 'prisma-bug',
            sessions: {
              createMany: {
                data: [
                  { id: 'g', name: 'github' },
                  { id: 'i', name: 'issue' },
                ],
              },
            },
          },
          include: { sessions: true },
        })
        expect(events).toMatchObject({
          id: 'prisma',
          name: 'prisma-bug',
          sessions: [
            {
              eventId: 'prisma',
              id: 'g',
              name: 'github',
            },
            {
              eventId: 'prisma',
              id: 'i',
              name: 'issue',
            },
          ],
        })

        await prisma.event.delete({ where: { id: 'prisma' } })

        const sessions = await prisma.session.findMany({ orderBy: { id: 'asc' } })
        expect(sessions).toMatchObject([])
      })
    })
  },
  // Use `optOut` to opt out from testing the default selected providers
  // otherwise the suite will require all providers to be specified.
  {
    optOut: {
      from: [
        Providers.MONGODB,
        Providers.SQLSERVER,
        Providers.MYSQL,
        Providers.POSTGRESQL,
        Providers.COCKROACHDB,
        Providers.SQLITE,
      ],
      reason: 'Only testing xyz provider(s) so opting out of xxx',
    },
  },
)
