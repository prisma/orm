import * as path from 'path'

import { getTestSuiteSchema } from '../_utils/getTestSuiteInfo'
import { Providers } from '../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  (suiteConfig, suiteMeta) => {
    // an example of how to query with the preloaded client
    test('findMany', async () => {
      await prisma.user.findMany()
    })

    test('suiteConfig', () => {
      /*
      {
        provider: Providers.SQLITE
        id: 'Int @id @default(autoincrement())',
        randomString: 'foo',
        previewFeatures: '"relationJoins"'
      }
    */

      expect(typeof suiteConfig.provider).toEqual('string')
    })

    test('suiteMeta', () => {
      /*
      {
        testName: '_example',
        testPath: '/code/prisma/packages/client/tests/functional/_example/tests.ts',
        testRoot: '/code/projects/prisma/packages/client/tests/functional/_example',
        rootRelativeTestPath: 'tests.ts',
        rootRelativeTestDir: '.',
        testFileName: 'tests.ts',
        prismaPath: '/code/prisma/packages/client/tests/functional/_example/prisma',
        _matrixPath: '/code/prisma/packages/client/tests/functional/_example/_matrix',
        _schemaPath: '/code/prisma/packages/client/tests/functional/_example/prisma/_schema'
      }
    */

      expect(typeof suiteMeta.testPath).toEqual('string')
      expect(suiteMeta.testFileName).toEqual(path.basename(__filename))
    })

    test('getTestSuiteSchema', () => {
      const schemaString = getTestSuiteSchema({
        cliMeta: {
          dataProxy: false,
          runtime: 'client',
          previewFeatures: [],
          generatorType: 'prisma-client-js',
          clientEngineExecutor: 'local',
        },
        suiteMeta,
        matrixOptions: suiteConfig,
      })

      expect(schemaString).toContain('generator')
      expect(schemaString).toContain('datasource')
      expect(schemaString).toContain('model')
    })

    testIf(suiteConfig.provider !== Providers.MONGODB)('conditional @ts-test-if', async () => {
      // @ts-test-if: provider !== Providers.MONGODB
      await prisma.$queryRaw`SELECT 1;`
    })
  },
  // Use `optOut` to opt out from testing the default selected providers
  // otherwise the suite will require all providers to be specified.
  // {
  //   optOut: {
  //     from: ['sqlite', 'mongodb'],
  //     reason: 'Only testing xyz provider(s) so opting out of sqlite and mongodb',
  //   },
  // },
)
