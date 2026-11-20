import path from 'node:path'
import timers from 'node:timers/promises'
import { Worker } from 'node:worker_threads'

import { afterAll, beforeAll, test } from '@jest/globals'

import type { Client, PrismaClientOptions } from '../../../src/runtime/getPrismaClient'
import { checkMissingProviders } from './checkMissingProviders'
import {
  getTestSuiteClientMeta,
  getTestSuiteCliMeta,
  getTestSuiteConfigs,
  getTestSuiteFolderPath,
  getTestSuiteMeta,
  TestSuiteMeta,
} from './getTestSuiteInfo'
import { getTestSuitePlan } from './getTestSuitePlan'
import type {
  QpeWorkerReadyResponse,
  QpeWorkerResponse,
  QpeWorkerShutdownMessage,
  QpeWorkerStartMessage,
} from './qpe-worker'
import {
  getPrismaClientInternalArgs,
  setupTestSuiteClient,
  setupTestSuiteClientDriverAdapter,
} from './setupTestSuiteClient'
import { DatasourceInfo, dropTestSuiteDatabase, setupTestSuiteDatabase, setupTestSuiteDbURI } from './setupTestSuiteEnv'
import { ClientMeta, CliMeta, MatrixOptions } from './types'

export type TestCallbackSuiteMeta = TestSuiteMeta & { generatedFolder: string }

/**
 * How does this work from a high level? What steps?
 * 1. You create a file that uses `setupTestSuiteMatrix`
 * 2. It defines a test suite, but it is a special one
 * 3. You create a `_matrix.ts` near your test suite
 * 4. This defines the test suite matrix to be used
 * 5. You write a few tests inside your test suite
 * 7. Execute tests like you usually would with jest
 * 9. The test suite expands into many via the matrix
 * 10. Each test suite has it's own generated schema
 * 11. Each test suite has it's own database, and env
 * 12. Each test suite has it's own generated client
 * 13. Each test suite is executed with those files
 * 14. Each test suite has its environment cleaned up
 *
 * @remarks Why does each test suite have a generated schema? This is to support
 * multi-provider testing and more. A base schema is automatically injected with
 * the cross-product of the configs defined in `_matrix.ts` (@see _example).
 *
 * @remarks Generated files are used for getting the test ready for execution
 * (writing the schema, the generated client, etc...). After the test are done
 * executing, the files can easily be submitted for type checking.
 *
 * @remarks Treat `_matrix.ts` as being analogous to a github action matrix.
 *
 * @remarks Jest snapshots will work out of the box, but not inline snapshots
 * because those can't work in a loop (jest limitation). To make it work, you
 * just need to pass `-u` to jest and we do the magic to make it work.
 *
 * @param tests where you write your tests
 */
function setupTestSuiteMatrix(
  tests: (
    suiteConfig: Record<string, string>,
    suiteMeta: TestCallbackSuiteMeta,
    clientMeta: ClientMeta,
    cliMeta: CliMeta,
    datasourceInfo: DatasourceInfo,
  ) => void,
  options?: MatrixOptions,
) {
  const originalEnv = { ...process.env }
  const restoreEnv = () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key]
      }
    }

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
  const suiteMeta = getTestSuiteMeta()
  const cliMeta = getTestSuiteCliMeta()
  const suiteConfigs = getTestSuiteConfigs(suiteMeta)
  const testPlan = getTestSuitePlan(cliMeta, suiteMeta, suiteConfigs, options)

  if (originalEnv.TEST_GENERATE_ONLY === 'true') {
    options = options ?? {}
    options.skipDefaultClientInstance = true
    options.skipDb = true
  }

  checkMissingProviders({
    suiteConfigs,
    suiteMeta,
    options,
  })

  for (const { name, suiteConfig, skip } of testPlan) {
    const clientMeta = getTestSuiteClientMeta({ suiteConfig: suiteConfig.matrixOptions })
    const generatedFolder = getTestSuiteFolderPath({ suiteMeta, suiteConfig })
    const describeFn = skip ? describe.skip : describe

    let disposeWrangler: (() => Promise<void>) | undefined
    let cfWorkerBindings: Record<string, unknown> | undefined

    describeFn(name, () => {
      const clients = [] as any[]
      const datasourceInfo = setupTestSuiteDbURI({ suiteConfig: suiteConfig.matrixOptions })
      let qpeWorker: Worker | undefined

      // we inject modified env vars, and make the client available as globals
      beforeAll(async () => {
        globalThis['datasourceInfo'] = datasourceInfo // keep it here before anything runs

        // If using D1 Driver adapter
        // We need to setup wrangler bindings to the D1 db (using miniflare under the hood)
        if (suiteConfig.matrixOptions.driverAdapter === 'js_d1') {
          const { getPlatformProxy } = require('wrangler') as typeof import('wrangler')
          const { env, dispose } = await getPlatformProxy({
            configPath: path.join(__dirname, './wrangler.toml'),
          })

          // Expose the bindings to the test suite
          disposeWrangler = dispose
          cfWorkerBindings = env
        }

        const [clientModule, sqlModule] = await setupTestSuiteClient({
          generatorType: suiteConfig.matrixOptions.generatorType || 'prisma-client-js',
          cliMeta,
          suiteMeta,
          suiteConfig,
          datasourceInfo,
          clientMeta,
          skipDb: options?.skipDb,
          alterStatementCallback: options?.alterStatementCallback,
          cfWorkerBindings,
        })

        globalThis['loaded'] = clientModule

        if (clientMeta.clientEngineExecutor === 'remote') {
          qpeWorker = new Worker(path.join(__dirname, 'qpe-worker-entry.cjs'))

          const qpeStartupTimeoutMs = 60_000

          const { hostname, port } = await new Promise<QpeWorkerReadyResponse>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              void qpeWorker!
                .terminate()
                .catch((err) => console.error('Error terminating QPE worker due to startup timeout:', err))
              qpeWorker = undefined
              reject(new Error(`QPE worker startup timed out after ${qpeStartupTimeoutMs}ms`))
            }, qpeStartupTimeoutMs).unref()

            qpeWorker!.once('message', (response: QpeWorkerResponse) => {
              clearTimeout(timeoutId)
              switch (response.type) {
                case 'ready':
                  resolve(response)
                  break
                case 'error':
                  reject(new Error(response.message))
                  break
                default:
                  reject(new Error(`Unexpected response type: ${response.type}`))
              }
            })

            qpeWorker!.postMessage({
              type: 'start',
              databaseUrl: datasourceInfo.databaseUrl,
            } satisfies QpeWorkerStartMessage)
          })

          datasourceInfo.accelerateUrl = `prisma://${hostname}:${port}/?api_key=1&use_http=1`
        }

        const internalArgs = () =>
          getPrismaClientInternalArgs({
            suiteConfig,
            clientMeta,
          })

        const newDriverAdapter = () =>
          setupTestSuiteClientDriverAdapter({
            suiteConfig,
            clientMeta,
            datasourceInfo,
            cfWorkerBindings,
          })

        globalThis['newPrismaClient'] = (args: any) => {
          const { PrismaClient, Prisma } = clientModule

          const options: PrismaClientOptions = {
            ...internalArgs(),
            ...newDriverAdapter(),
            accelerateUrl: datasourceInfo.accelerateUrl,
            ...args,
          }

          const client = new PrismaClient(options)

          globalThis['Prisma'] = Prisma
          clients.push(client)

          return client as Client
        }

        if (!options?.skipDefaultClientInstance) {
          globalThis['prisma'] = globalThis['newPrismaClient']() as Client
        }

        globalThis['Prisma'] = clientModule['Prisma']

        globalThis['sql'] = sqlModule

        globalThis['db'] = {
          setupDb: () =>
            setupTestSuiteDatabase({
              suiteMeta,
              suiteConfig,
              alterStatementCallback: options?.alterStatementCallback,
              cfWorkerBindings,
              datasourceInfo,
            }),
          dropDb: () =>
            dropTestSuiteDatabase({ suiteMeta, suiteConfig, errors: [], cfWorkerBindings, datasourceInfo }).catch(
              () => {},
            ),
        }
      })

      afterAll(async () => {
        if (disposeWrangler) {
          await disposeWrangler()
        }

        for (const client of clients) {
          await client.$disconnect().catch(() => {
            // sometimes we test connection errors. In that case,
            // disconnect might also fail, so ignoring the error here
          })
        }
        clients.length = 0

        if (qpeWorker) {
          try {
            await Promise.race([
              timers.setTimeout(5000, undefined, { ref: false }),

              new Promise<void>((resolve, reject) => {
                qpeWorker!.once('message', (response: QpeWorkerResponse) => {
                  switch (response.type) {
                    case 'shutdown-complete':
                      resolve()
                      break
                    case 'error':
                      reject(new Error(response.message))
                      break
                    default:
                      reject(new Error(`Unexpected response type: ${response.type}`))
                  }
                })

                qpeWorker!.postMessage({ type: 'shutdown' } satisfies QpeWorkerShutdownMessage)
              }),
            ])
          } finally {
            await qpeWorker.terminate()
            qpeWorker = undefined
          }
        }

        // CI=false: Only drop the db if not skipped, and if the db does not need to be reused.
        // CI=true always skip to save time
        if (options?.skipDb !== true && process.env.TEST_REUSE_DATABASE !== 'true' && process.env.CI !== 'true') {
          const datasourceInfo = globalThis['datasourceInfo'] as DatasourceInfo
          process.env[datasourceInfo.envVarName] = datasourceInfo.databaseUrl
          process.env[datasourceInfo.directEnvVarName] = datasourceInfo.databaseUrl
          await dropTestSuiteDatabase({ suiteMeta, suiteConfig, errors: [], cfWorkerBindings, datasourceInfo })
        }
        restoreEnv()
        delete globalThis['datasourceInfo']
        delete globalThis['loaded']
        delete globalThis['prisma']
        delete globalThis['Prisma']
        delete globalThis['sql']
        delete globalThis['newPrismaClient']
      }, 180_000)

      if (originalEnv.TEST_GENERATE_ONLY === 'true') {
        // because we have our own custom `test` global call defined that reacts
        // to this env var already, we import the original jest `test` and call
        // it because we need to run at least one test to generate the client
        test('generate only', () => {})
      }

      tests(suiteConfig.matrixOptions, { ...suiteMeta, generatedFolder }, clientMeta, cliMeta, datasourceInfo)
    })
  }
}

export { setupTestSuiteMatrix }
