import type { D1Database } from '@cloudflare/workers-types'
import {
  generateClient as generateClientLegacy,
  type GenerateClientOptions as GenerateClientLegacyOptions,
} from '@prisma/client-generator-js'
import {
  generateClient as generateClientESM,
  type GenerateClientOptions as GenerateClientESMOptions,
} from '@prisma/client-generator-ts'
import { SqlQueryOutput } from '@prisma/generator'
import { getDMMF, parseEnvValue, processSchemaResult, validatePrismaConfigWithDatasource } from '@prisma/internals'
import path from 'path'
import { fetch, WebSocket } from 'undici'

import { introspectSql } from '../../../../cli/src/generate/introspectSql'
import { PrismaClientOptions } from '../../../src/runtime/getPrismaClient'
import { buildPrismaConfig } from './config-builder'
import type { NamedTestSuiteConfig, TestSuiteMeta } from './getTestSuiteInfo'
import {
  getTestSuiteFolderPath,
  getTestSuiteSchema,
  getTestSuiteSchemaPath,
  testSuiteHasTypedSql,
} from './getTestSuiteInfo'
import { AdapterProviders, GeneratorTypes } from './providers'
import { DatasourceInfo, setupTestSuiteDatabase, setupTestSuiteFiles, setupTestSuiteSchema } from './setupTestSuiteEnv'
import { AlterStatementCallback, ClientMeta, ClientRuntime, CliMeta } from './types'

const runtimeBase = path.join(__dirname, '..', '..', '..', 'runtime')

/**
 * Does the necessary setup to get a test suite client ready to run.
 * @param suiteMeta
 * @param suiteConfig
 * @returns tuple of loaded client folder + loaded sql folder
 */
export async function setupTestSuiteClient({
  generatorType,
  cliMeta,
  suiteMeta,
  suiteConfig,
  datasourceInfo,
  clientMeta,
  skipDb,
  alterStatementCallback,
  cfWorkerBindings,
}: {
  generatorType: GeneratorTypes
  cliMeta: CliMeta
  suiteMeta: TestSuiteMeta
  suiteConfig: NamedTestSuiteConfig
  datasourceInfo: DatasourceInfo
  clientMeta: ClientMeta
  skipDb?: boolean
  alterStatementCallback?: AlterStatementCallback
  cfWorkerBindings?: Record<string, unknown>
}) {
  const suiteFolderPath = getTestSuiteFolderPath({ suiteMeta, suiteConfig })
  const schemaPath = getTestSuiteSchemaPath({ suiteMeta, suiteConfig })
  const schema = getTestSuiteSchema({ cliMeta, suiteMeta, matrixOptions: suiteConfig.matrixOptions })
  const dmmf = await getDMMF({ datamodel: [[schemaPath, schema]] })
  const schemaContext = await processSchemaResult({
    schemaResult: { schemas: [[schemaPath, schema]], schemaPath, schemaRootDir: path.dirname(schemaPath) },
  })
  const generator = schemaContext.generators.find((g) =>
    ['prisma-client-js', 'prisma-client-ts', 'prisma-client'].includes(parseEnvValue(g.provider)),
  )!
  const hasTypedSql = await testSuiteHasTypedSql(suiteMeta)

  await setupTestSuiteFiles({ suiteMeta, suiteConfig })
  await setupTestSuiteSchema({ suiteMeta, suiteConfig, schema })

  process.env[datasourceInfo.directEnvVarName] = datasourceInfo.databaseUrl
  process.env[datasourceInfo.envVarName] = datasourceInfo.databaseUrl

  if (skipDb !== true) {
    await setupTestSuiteDatabase({
      suiteMeta,
      suiteConfig,
      alterStatementCallback,
      cfWorkerBindings,
      datasourceInfo,
    })
  }

  let typedSql: SqlQueryOutput[] | undefined
  if (hasTypedSql) {
    const config = buildPrismaConfig({ suiteMeta, suiteConfig, datasourceInfo })
    const validatedConfig = validatePrismaConfigWithDatasource({
      config,
      command: 'prisma <test-suite> generate --sql',
    })
    const schemaContextIntrospect = await processSchemaResult({
      schemaResult: { schemas: [[schemaPath, schema]], schemaPath, schemaRootDir: path.dirname(schemaPath) },
    })
    typedSql = await introspectSql(validatedConfig, path.dirname(schemaPath), schemaContextIntrospect)
  }

  if (datasourceInfo.accelerateUrl !== undefined) {
    process.env[datasourceInfo.envVarName] = datasourceInfo.accelerateUrl
  } else {
    process.env[datasourceInfo.envVarName] = datasourceInfo.databaseUrl
  }
  const outputPath = generatorType === 'prisma-client-ts' ? 'generated/prisma' : 'generated/prisma/client'

  const clientGenOptions: GenerateClientLegacyOptions & GenerateClientESMOptions = {
    datamodel: schema,
    schemaPath,
    binaryPaths: {},
    datasources: schemaContext.datasources,
    outputDir: path.join(suiteFolderPath, outputPath),
    copyRuntime: false,
    dmmf: dmmf,
    generator: generator,
    engineVersion: '0000000000000000000000000000000000000000',
    clientVersion: '0.0.0',
    testMode: true,
    activeProvider: suiteConfig.matrixOptions.provider,
    runtimeBase,
    runtimeSourcePath: path.join(__dirname, '../../../runtime'),
    typedSql,
    target: 'nodejs',
    generatedFileExtension: 'ts',
    importFileExtension: '',
    moduleFormat: 'cjs',
    tsNoCheckPreamble: false,
    compilerBuild: 'fast',
  }

  if (generatorType === 'prisma-client-ts') {
    await generateClientESM(clientGenOptions)
  } else {
    await generateClientLegacy(clientGenOptions)
  }

  const clientPathForRuntime: Record<ClientRuntime, { client: string; sql: string }> = {
    'wasm-compiler-edge': {
      client: generatorType === 'prisma-client-ts' ? 'generated/prisma/client' : 'generated/prisma/client/edge',
      sql:
        generatorType === 'prisma-client-ts'
          ? path.join(outputPath, 'sql.ts')
          : path.join(outputPath, 'sql', 'index.wasm-compiler-edge.js'),
    },
    client: {
      client: 'generated/prisma/client',
      sql: path.join(outputPath, 'sql'),
    },
  }

  const clientModule = require(path.join(suiteFolderPath, clientPathForRuntime[clientMeta.runtime].client))
  let sqlModule = undefined
  if (hasTypedSql) {
    sqlModule = require(path.join(suiteFolderPath, clientPathForRuntime[clientMeta.runtime].sql))
  }

  return [clientModule, sqlModule]
}

/**
 * Automatically loads the driver adapter for the test suite client.
 */
export function setupTestSuiteClientDriverAdapter({
  suiteConfig,
  datasourceInfo,
  clientMeta,
  cfWorkerBindings,
}: {
  suiteConfig: NamedTestSuiteConfig
  datasourceInfo: DatasourceInfo
  clientMeta: ClientMeta
  cfWorkerBindings?: Record<string, unknown>
}) {
  const driverAdapter = suiteConfig.matrixOptions.driverAdapter

  if (clientMeta.driverAdapter !== true) return {}

  if (driverAdapter === undefined) {
    throw new Error(`Missing Driver Adapter`)
  }

  if (driverAdapter === AdapterProviders.JS_PG || driverAdapter === AdapterProviders.JS_PG_COCKROACHDB) {
    const { PrismaPg } = require('@prisma/adapter-pg') as typeof import('@prisma/adapter-pg')

    return {
      adapter: new PrismaPg({
        connectionString: datasourceInfo.databaseUrl,
      }),
    }
  }

  if (driverAdapter === AdapterProviders.JS_NEON) {
    const { neonConfig } = require('@neondatabase/serverless') as typeof import('@neondatabase/serverless')
    const { PrismaNeon } = require('@prisma/adapter-neon') as typeof import('@prisma/adapter-neon')

    neonConfig.wsProxy = () => `127.0.0.1:5488/v1`
    neonConfig.webSocketConstructor = WebSocket
    neonConfig.useSecureWebSocket = false // disable tls
    neonConfig.pipelineConnect = false

    return {
      adapter: new PrismaNeon({
        connectionString: datasourceInfo.databaseUrl,
      }),
    }
  }

  if (driverAdapter === AdapterProviders.JS_PLANETSCALE) {
    const { PrismaPlanetScale } = require('@prisma/adapter-planetscale') as typeof import('@prisma/adapter-planetscale')

    const url = new URL('http://root:root@127.0.0.1:8085')
    url.pathname = new URL(datasourceInfo.databaseUrl).pathname

    return {
      adapter: new PrismaPlanetScale({
        url: url.toString(),
        fetch, // TODO remove when Node 16 is deprecated
      }),
    }
  }

  if (driverAdapter === AdapterProviders.JS_LIBSQL) {
    const { PrismaLibSql } = require('@prisma/adapter-libsql') as typeof import('@prisma/adapter-libsql')

    return {
      adapter: new PrismaLibSql({
        url: datasourceInfo.databaseUrl,
        intMode: 'bigint',
      }),
    }
  }

  if (driverAdapter === AdapterProviders.JS_D1) {
    const { PrismaD1 } = require('@prisma/adapter-d1') as typeof import('@prisma/adapter-d1')

    const d1Client = cfWorkerBindings!.MY_DATABASE as D1Database
    return { adapter: new PrismaD1(d1Client) }
  }

  if (driverAdapter === AdapterProviders.JS_BETTER_SQLITE3) {
    const { PrismaBetterSqlite3 } =
      require('@prisma/adapter-better-sqlite3') as typeof import('@prisma/adapter-better-sqlite3')

    return {
      adapter: new PrismaBetterSqlite3({
        // Workaround to avoid the Prisma validation error:
        // ```
        // Error validating datasource `db`: the URL must start with the protocol `file:`
        // ```
        url: datasourceInfo.databaseUrl.replace('file:', ''),
      }),
    }
  }

  if (driverAdapter === AdapterProviders.JS_MSSQL) {
    const { PrismaMssql } = require('@prisma/adapter-mssql') as typeof import('@prisma/adapter-mssql')

    const [, server, port, database, user, password] =
      datasourceInfo.databaseUrl.match(
        /^sqlserver:\/\/([^:;]+):(\d+);database=([^;]+);user=([^;]+);password=([^;]+);/,
      ) || []

    return {
      adapter: new PrismaMssql({
        user,
        password,
        database,
        server,
        port: Number(port),
        options: {
          trustServerCertificate: true,
        },
      }),
    }
  }

  if (driverAdapter === 'js_mariadb') {
    const { PrismaMariaDb } = require('@prisma/adapter-mariadb') as typeof import('@prisma/adapter-mariadb')

    const url = new URL(datasourceInfo.databaseUrl)
    const { username: user, password, hostname: host, port } = url
    const database = url.pathname && url.pathname.slice(1)

    return {
      adapter: new PrismaMariaDb({
        user,
        password,
        database,
        host,
        port: Number(port),
        connectionLimit: 4, // avoid running out of connections, some tests create multiple clients
      }),
    }
  }

  throw new Error(`No Driver Adapter support for ${driverAdapter}`)
}

/**
 * Constructs the `__internal` argument of `PrismaClient` that contains configuration overrides
 * specific to the test environment.
 */
export function getPrismaClientInternalArgs({
  suiteConfig,
  clientMeta,
}: {
  suiteConfig: NamedTestSuiteConfig
  clientMeta: ClientMeta
}) {
  const provider = suiteConfig.matrixOptions.provider
  const __internal: PrismaClientOptions['__internal'] = {}

  if (clientMeta.runtime === 'client' || clientMeta.runtime === 'wasm-compiler-edge') {
    __internal.configOverride = (config) => {
      config.compilerWasm = {
        getRuntime: () => Promise.resolve(require(path.join(runtimeBase, `query_compiler_fast_bg.${provider}.js`))),
        getQueryCompilerWasmModule: () => {
          const queryCompilerWasmFilePath = path.join(runtimeBase, `query_compiler_fast_bg.${provider}.wasm-base64.js`)
          const wasmBase64: string = require(queryCompilerWasmFilePath).wasm
          return Promise.resolve(new WebAssembly.Module(Buffer.from(wasmBase64, 'base64')))
        },
        importName: './query_compiler_fast_bg.js',
      }
      return config
    }
  }

  return { __internal }
}
