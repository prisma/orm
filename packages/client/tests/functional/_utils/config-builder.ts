import { defaultTestConfig, type PrismaConfigInternal } from '@prisma/config'

import { getTestSuiteSchemaPath, type NamedTestSuiteConfig, type TestSuiteMeta } from './getTestSuiteInfo'
import type { DatasourceInfo } from './setupTestSuiteEnv'

export function buildPrismaConfig({
  suiteMeta,
  suiteConfig,
  datasourceInfo,
}: {
  suiteMeta: TestSuiteMeta
  suiteConfig: NamedTestSuiteConfig
  datasourceInfo: DatasourceInfo
}): PrismaConfigInternal {
  const schemaPath = getTestSuiteSchemaPath({ suiteMeta, suiteConfig })
  return buildPrismaConfigInternal(schemaPath, datasourceInfo.databaseUrl)
}

function buildPrismaConfigInternal(schemaPath: string, databaseUrl: string): PrismaConfigInternal {
  return {
    ...defaultTestConfig(),
    schema: schemaPath,
    datasource: {
      url: databaseUrl,
    },
  }
}
