import testMatrix from './_matrix'
// @ts-ignore
import type * as imports from './generated/prisma/client'

declare let prisma: imports.PrismaClient
declare let loaded: {
  SuggestionStatus: typeof imports.SuggestionStatus
}

testMatrix.setupTestSuite(
  () => {
    test('create with mapped enum', async () => {
      const { SuggestionStatus } = loaded

      const enrichment = await prisma.suggestionModel.create({
        data: {
          suggestedContent: 'some content',
          status: SuggestionStatus.PENDING,
        },
      })

      expect(enrichment.status).toBe('PENDING')
    })
  },
  {
    optOut: {
      from: ['sqlite', 'mysql', 'mongodb', 'cockroachdb', 'sqlserver'],
      reason: 'Issue reported for Postgres, keeping it focused.',
    },
  },
)
