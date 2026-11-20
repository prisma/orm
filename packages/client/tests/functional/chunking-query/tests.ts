import { Providers } from '../_utils/providers'
import testMatrix from './_matrix'
import {
  EXCESS_BIND_VALUES_BY_PROVIDER,
  MAX_BIND_VALUES_BY_PROVIDER,
  RELATION_JOINS_NO_CHUNKING_ERROR_MSG,
} from './_utils'
// @ts-ignore
import type { PrismaClient, Tag } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  ({ provider, driverAdapter, clientEngineExecutor }, _suiteMeta, _clientMeta, cliMeta) => {
    const MAX_BIND_VALUES = MAX_BIND_VALUES_BY_PROVIDER[provider]
    const EXCESS_BIND_VALUES = EXCESS_BIND_VALUES_BY_PROVIDER[provider]

    const usesJsDrivers = driverAdapter !== undefined || clientEngineExecutor === 'remote'

    function generatedIds(n: number) {
      // ["1","2",...,"n"]
      const ids = Array.from({ length: n }, (_, i) => i + 1)
      return ids
    }

    const usingRelationJoins = cliMeta.previewFeatures.includes('relationJoins')

    // Chunking is not supported with joins, so the tests for success cases need to be skipped
    describeIf(!usingRelationJoins)('issues #8832 / #9326 success cases', () => {
      async function createTags(n: number): Promise<number[]> {
        const ids = generatedIds(n)
        const data = ids.map((id) => ({ id }))
        await prisma.tag.createMany({
          data,
        })
        return ids
      }

      async function getTagsFindManyInclude(): Promise<Tag[]> {
        const tags = await prisma.tag.findMany({
          include: {
            posts: true,
          },
        })
        return tags
      }

      async function getTagsParams(ids: number[]): Promise<Tag[]> {
        const idsParams = ids.map((paramIdx) => {
          const param = ['mysql', 'sqlite'].includes(provider) ? '?' : `\$${paramIdx}`
          return param
        })

        const tags = await prisma.$queryRawUnsafe<Tag[]>(
          `
            SELECT *
            FROM tag
            WHERE id IN (${idsParams.join(', ')})
          `,
          ...ids,
        )
        return tags
      }

      async function getTagsFindManyIn(ids: number[]): Promise<Tag[]> {
        const tags = await prisma.tag.findMany({
          where: {
            id: {
              in: ids,
            },
          },
        })
        return tags
      }

      async function clean() {
        await prisma.$transaction([prisma.tagsOnPosts.deleteMany(), prisma.post.deleteMany(), prisma.tag.deleteMany()])
      }

      afterEach(async () => {
        await clean()
      }, 80_000)

      test('should succeed when "in" has MAX ids', async () => {
        const ids = await createTags(MAX_BIND_VALUES)
        const tags = await getTagsFindManyIn(ids)

        expect(tags.length).toBe(MAX_BIND_VALUES)
      })

      test('should succeed when "include" involves MAX records', async () => {
        await createTags(MAX_BIND_VALUES)
        const tags = await getTagsFindManyInclude()

        expect(tags.length).toBe(MAX_BIND_VALUES)
      })

      test('should succeed when "in" has EXCESS ids', async () => {
        const ids = await createTags(EXCESS_BIND_VALUES)
        const tags = await getTagsFindManyIn(ids)

        expect(tags.length).toBe(EXCESS_BIND_VALUES)
      })

      test('should succeed when "include" involves EXCESS records', async () => {
        await createTags(EXCESS_BIND_VALUES)
        const tags = await getTagsFindManyInclude()

        expect(tags.length).toBe(EXCESS_BIND_VALUES)
      })

      // Chunking mechanism looks flawed with pagination.
      // See https://github.com/prisma/prisma/issues/23733 for more info
      // eslint-disable-next-line jest/no-disabled-tests
      test.skip('should succeed when "in" has EXCESS ids and a "skip" filter', async () => {
        const ids = await createTags(EXCESS_BIND_VALUES)

        const tags = await prisma.tag.findMany({
          where: {
            id: { in: ids },
          },
          skip: 1,
        })

        expect(tags.length).toBe(EXCESS_BIND_VALUES - 1)
      })

      test('should succeed when raw query has MAX ids', async () => {
        const ids = await createTags(MAX_BIND_VALUES)
        const tags = await getTagsParams(ids)

        expect(tags.length).toBe(MAX_BIND_VALUES)
      })

      // Sqlite excluded because it's bind parameter limit is currently incorrect which makes the QE chunk queries enough to not trigger the error.
      testIf(!usesJsDrivers && provider !== Providers.SQLITE)('should fail when raw query has EXCESS ids', async () => {
        const ids = await createTags(EXCESS_BIND_VALUES)

        await expect(getTagsParams(ids)).rejects.toThrow()
      })
    })

    // Sqlite excluded because it's bind parameter limit is currently incorrect which makes the QE chunk queries enough to not trigger the error.
    //
    // See: https://github.com/prisma/prisma/issues/21802.
    // See: https://github.com/prisma/prisma/issues/21803.
    describeIf(provider !== Providers.SQLITE)('chunking logic does not trigger with 2 IN filters', () => {
      function selectWith2InFilters(ids: number[]) {
        return prisma.tag.findMany({
          where: {
            OR: [
              {
                id: { in: ids },
              },
              {
                id: { in: ids },
              },
            ],
          },
        })
      }

      test('Selecting MAX ids at once in two inclusive disjunct filters succeeds', async () => {
        // subtract 1 to account for the OFFSET parameters and divide by 2 to account for the
        // two IN filters
        const ids = generatedIds((MAX_BIND_VALUES - 1) / 2)
        await expect(selectWith2InFilters(ids)).resolves.toMatchInlineSnapshot(`[]`)
      })

      test('Selecting EXCESS ids at once in two inclusive disjunct filters results in error', async () => {
        const ids = generatedIds(EXCESS_BIND_VALUES)

        if (usingRelationJoins) {
          if (driverAdapter === 'js_pg' || driverAdapter === 'js_pg_cockroachdb') {
            await expect(selectWith2InFilters(ids)).rejects.toThrow(
              'The query parameter limit supported by your database is exceeded',
            )
          } else {
            await expect(selectWith2InFilters(ids)).rejects.toThrow(RELATION_JOINS_NO_CHUNKING_ERROR_MSG)
          }
        } else {
          await expect(selectWith2InFilters(ids)).rejects.toThrow()
        }
      })
    })
  },
  {
    optOut: {
      from: ['sqlserver', 'mongodb'],
      reason: 'not relevant for this test.',
    },
    skipDriverAdapter: {
      from: ['js_planetscale', 'js_neon', 'js_d1', 'js_mariadb'],

      // `rpc error: code = Aborted desc = Row count exceeded 10000 (CallerID: userData1)", state: "70100"`
      // This could potentially be configured in Vitess by increasing the `queryserver-config-max-result-size`
      // query server parameter.
      reason:
        'Vitess supports at most 10k rows returned in a single query, so this test is not applicable. ' +
        'Neon occasionally fails with different parameter counts in its error messages. ' +
        'D1 does not have the correct amount of max_bind_values.' +
        'The query appears to raise no error with the MariaDB driver adapter.',
    },
    skip(when, { clientEngineExecutor, provider }) {
      when(
        clientEngineExecutor === 'remote' && provider === Providers.MYSQL,
        `
        Query plan executor server uses MariaDB driver internally.
        `,
      )
    },
  },
)
