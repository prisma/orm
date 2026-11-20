import { AdapterProviders } from '../../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

/**
 * Regression test for #11740 & comment
 * Stored queries in variables for batched tx
 */
testMatrix.setupTestSuite(
  () => {
    test('stored query triggered twice should fail but not exit process', async () => {
      const query = prisma.resource.create({
        data: {
          email: 'john@prisma.io',
        },
      })

      const result = prisma.$transaction([query, query])

      await expect(result).rejects.toMatchPrismaErrorSnapshot()
    })

    test('stored query trigger .requestTransaction twice should fail', async () => {
      const query = prisma.resource.create({
        data: {
          email: 'john@prisma.io',
        },
      })

      const fn = async () => {
        await (query as any).requestTransaction({ kind: 'batch', lock: Promise.resolve() })
        await (query as any).requestTransaction({ kind: 'batch', lock: Promise.resolve() })
      }

      await expect(fn()).rejects.toMatchPrismaErrorSnapshot()
    })

    test('no multiple resolves should happen', async () => {
      const mockMultipleResolve = jest.fn()

      process.on('multipleResolves', mockMultipleResolve)

      const query = prisma.resource.create({ data: { email: 'john@prisma.io' } })

      const result = prisma.$transaction([query, query])

      await expect(result).rejects.toThrow()

      expect(mockMultipleResolve).toHaveBeenCalledTimes(0)
    })
  },
  {
    skipDriverAdapter: {
      from: [AdapterProviders.JS_LIBSQL],
      reason: 'js_libsql: SIGABRT due to panic in libsql (not yet implemented: unsupported type)', // TODO: ORM-867
    },
  },
)
