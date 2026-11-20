import { GeneratorConfig, SqlQueryOutput } from '@prisma/generator'
import type { PrismaConfigWithDatasource, SchemaContext } from '@prisma/internals'

import { Migrate } from '../Migrate'
import { SchemaEngine } from '../SchemaEngine'
import { EngineArgs } from '../types'

const supportedProviders = ['postgresql', 'cockroachdb', 'mysql', 'sqlite']

export interface IntrospectSqlInput extends EngineArgs.SqlQueryInput {
  fileName: string
}

export type IntrospectSqlError = {
  fileName: string
  message: string
}

type IntrospectSingleResult =
  | {
      ok: true
      result: SqlQueryOutput
    }
  | {
      ok: false
      error: IntrospectSqlError
    }

export type IntrospectSqlResult =
  | {
      ok: true
      queries: SqlQueryOutput[]
    }
  | {
      ok: false
      errors: IntrospectSqlError[]
    }

export async function introspectSql(
  schemaContext: SchemaContext,
  config: PrismaConfigWithDatasource,
  baseDir: string,
  queries: IntrospectSqlInput[],
): Promise<IntrospectSqlResult> {
  if (!isTypedSqlEnabled(schemaContext.generators)) {
    throw new Error(`\`typedSql\` preview feature needs to be enabled in ${schemaContext.loadedFromPathForLogMessages}`)
  }

  const firstDatasource = schemaContext.primaryDatasource
  if (!firstDatasource) {
    throw new Error(`Could not find datasource in schema ${schemaContext.loadedFromPathForLogMessages}`)
  }
  if (!supportedProviders.includes(firstDatasource.activeProvider)) {
    throw new Error(`Typed SQL is supported only for ${supportedProviders.join(', ')} providers`)
  }

  const migrate = await Migrate.setup({ schemaContext, schemaEngineConfig: config, baseDir })
  const schemaEngine = migrate.engine
  const results: SqlQueryOutput[] = []
  const errors: IntrospectSqlError[] = []
  try {
    for (const query of queries) {
      const queryResult = await introspectSingleQuery(schemaEngine, config.datasource.url, query)
      if (queryResult.ok) {
        results.push(queryResult.result)
      } else {
        errors.push(queryResult.error)
      }
    }
  } finally {
    await schemaEngine.stop()
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, queries: results }
}

// engine is capabale of introspecting queries as a batch, but we need to map them back to files they defined in, so,
// for now, we sending them in one by one
async function introspectSingleQuery(
  schemaEngine: SchemaEngine,
  url: string,
  query: IntrospectSqlInput,
): Promise<IntrospectSingleResult> {
  try {
    const result = await schemaEngine.introspectSql({
      url,
      queries: [query],
    })
    const queryResult = result.queries[0]
    if (!queryResult) {
      return {
        ok: false,
        error: {
          fileName: query.fileName,
          message: 'Invalid response from schema engine',
        },
      }
    }
    return {
      ok: true,
      result: queryResult,
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        fileName: query.fileName,
        message: String(error),
      },
    }
  }
}

function isTypedSqlEnabled(generators: GeneratorConfig[]) {
  return generators.some((gen) => gen?.previewFeatures?.includes('typedSql'))
}
