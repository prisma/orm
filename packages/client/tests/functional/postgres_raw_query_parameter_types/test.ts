import { Providers } from '../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  (_suiteConfig, _suiteMeta) => {
    test('$queryRaw works with different parameter types', async () => {
      // Previously, there was a bug in how prepared statement caching was implemented.
      // Parameter types were disregarded, resulting in the prepared statement with the
      // wrong parameter types to be picked.
      // Below, we issue two queries with identical SQL text which have different
      // parameter types - integer vs decimal. If prepared statement cache does not respect
      // parameter types, same prepared statement will be picked for both, resulting in a
      // type mismatch error from Postgres.
      // Issues which were affected by this bug include:
      // - https://github.com/prisma/prisma/issues/22482
      // - https://github.com/prisma/prisma/issues/16611
      // - https://github.com/prisma/prisma/issues/23872
      // - https://github.com/prisma/prisma/issues/17110
      await prisma.$queryRaw`select * from version() where LENGTH("version") > ${1}`
      await prisma.$queryRaw`select * from version() where LENGTH("version") > ${1.1}`
    })
  },
  {
    optOut: {
      // if you are skipping tests for certain providers, you
      // have to list them here and specify the reason
      from: [Providers.MONGODB, Providers.COCKROACHDB, Providers.MYSQL, Providers.SQLITE, Providers.SQLSERVER],
      reason: 'Test exercises specific bug with Postgres prepared statement caching.',
    },
    skipDriverAdapter: {
      from: ['js_pg', 'js_pg_cockroachdb', 'js_neon'],
      reason: 'https://github.com/prisma/team-orm/issues/1159',
    },
    skip(when, { clientEngineExecutor }) {
      when(
        clientEngineExecutor === 'remote',
        `
        Query plan executor server uses driver adapters internally,
        so it is also affected by https://github.com/prisma/team-orm/issues/1159
        `,
      )
    },
  },
)
