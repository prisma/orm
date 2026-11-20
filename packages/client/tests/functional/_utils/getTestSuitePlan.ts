import { klona } from 'klona'

import { getTestSuiteFullName, NamedTestSuiteConfig, TestSuiteMeta } from './getTestSuiteInfo'
import { AdapterProviders, adaptersForProvider, Providers, relationModesForAdapter } from './providers'
import { CliMeta, MatrixOptions } from './types'

export type TestPlanEntry = {
  name: string
  skip: boolean
  suiteConfig: NamedTestSuiteConfig
}

type SuitePlanContext = {
  includedProviders?: string[]
  includedProviderAdapters?: string[]
  excludedProviders: string[]
  excludedDriverAdapters: string[]
  updateSnapshots: 'inline' | 'external' | undefined
}

/**
 * Get a test plan from a list of suite configs. Test plan tells what the name of
 * the tests are, what are their config and whether or not they should be executed or skipped
 * @param suiteMeta
 * @returns [test-suite-title: string, test-suite-config: object]
 */
export function getTestSuitePlan(
  testCliMeta: CliMeta,
  suiteMeta: TestSuiteMeta,
  suiteConfigs: NamedTestSuiteConfig[],
  options?: MatrixOptions,
): TestPlanEntry[] {
  const context = buildPlanContext()

  const expandedSuiteConfigs = suiteConfigs
    .flatMap(getExpandedTestSuitePlanWithProviderFlavors)
    .flatMap(getExpandedTestSuitePlanWithRemoteQpe)

  expandedSuiteConfigs.forEach((config) => {
    config.matrixOptions.clientRuntime ??= testCliMeta.runtime
    config.matrixOptions.previewFeatures ??= testCliMeta.previewFeatures
    config.matrixOptions.generatorType ??= testCliMeta.generatorType
    config.matrixOptions.clientEngineExecutor ??= testCliMeta.clientEngineExecutor
  })

  return expandedSuiteConfigs.map((namedConfig, configIndex) => ({
    name: getTestSuiteFullName(suiteMeta, namedConfig),
    skip: shouldSkipSuiteConfig(context, namedConfig, configIndex, testCliMeta, options),
    suiteConfig: namedConfig,
  }))
}

/**
 * This function takes a regular `testPlanEntry` and expands this into the
 * multiple compatible driver adapters that exist for a given provider. For
 * example, postgres => [postgres (pg), postgres (neon)], put very simply. In
 * other words, a given test matrix is expanded with the provider adapters.
 * @param suiteConfig
 * @returns
 */
function getExpandedTestSuitePlanWithProviderFlavors(suiteConfig: NamedTestSuiteConfig) {
  const provider = suiteConfig.matrixOptions.provider

  const suiteConfigExpansions = adaptersForProvider[provider].map((adapterProvider) => {
    const newSuiteConfig = klona(suiteConfig)

    newSuiteConfig.matrixOptions.driverAdapter = adapterProvider
    newSuiteConfig.parametersString += `, ${adapterProvider}`
    // ^^^ temporary until I get to the TODO in getTestSuiteParametersString

    // if the test is not doing stuff with relation mode already, we set one
    if (newSuiteConfig.matrixOptions.relationMode === undefined) {
      newSuiteConfig.matrixOptions.relationMode = relationModesForAdapter[adapterProvider]
    }

    return newSuiteConfig
  })

  // add the original suite config to the list of expanded configs
  return [suiteConfig, ...suiteConfigExpansions]
}

/**
 * Expands each suiteConfig entry to ensure we have separate entries for
 * client engine's remote executor which doesn't use driver adapters locally
 * and needs to have matrix entries on its own to ensure the names of generated
 * tests don't collide with those using QE without driver adapters. We need
 * this to have different snapshots for, e.g., errors.
 */
function getExpandedTestSuitePlanWithRemoteQpe(suiteConfig: NamedTestSuiteConfig) {
  if (suiteConfig.matrixOptions.driverAdapter) {
    suiteConfig.matrixOptions.clientEngineExecutor = 'local'
    return [suiteConfig]
  } else {
    // For each suite config that doesn't use driver adapters, we need
    // to clone it and create two separate configs:
    //  - one which doesn't require `ClientEngine` specifically and can
    //    be run with any engine type, but requires specifically a local
    //    executor in the event it is executed using `ClientEngine`;
    //  - another one which is only ever used with remote executor of
    //    `ClientEngine` and never runs with either a local exeuctor
    //    of the client engine nor any other engine type.
    // This is required to separate the snapshots between them.

    suiteConfig.matrixOptions.clientEngineExecutor = 'local'

    const remoteExecutorSuiteConfig = klona(suiteConfig)
    remoteExecutorSuiteConfig.matrixOptions.clientRuntime = 'client'
    remoteExecutorSuiteConfig.matrixOptions.clientEngineExecutor = 'remote'

    return [suiteConfig, remoteExecutorSuiteConfig]
  }
}

function shouldSkipSuiteConfig(
  {
    updateSnapshots,
    includedProviders,
    includedProviderAdapters,
    excludedProviders,
    excludedDriverAdapters: excludedProviderFlavors,
  }: SuitePlanContext,
  config: NamedTestSuiteConfig,
  configIndex: number,
  cliMeta: CliMeta,
  options?: MatrixOptions,
): boolean {
  const { provider, driverAdapter, relationMode, clientRuntime, clientEngineExecutor } = config.matrixOptions

  if (updateSnapshots === 'inline' && configIndex > 0) {
    // when updating inline snapshots, we have to run a  single suite only -
    // otherwise jest will fail with "Multiple inline snapshots for the same call are not supported" error
    return true
  }

  if (updateSnapshots === 'external' && configIndex === 0) {
    // when updating external snapshots, we assume that inline snapshots update was run just before it - so
    // there is no reason to re-run the first suite
    return true
  }

  // if one of the skip predicates is true, skip
  let isSkipped = false
  options?.skip?.((pred) => {
    isSkipped ||= typeof pred === 'boolean' ? pred : pred()
  }, config.matrixOptions)

  if (isSkipped) {
    return true
  }

  // if the client doesn't support the provider, skip
  if (cliMeta.dataProxy && provider === Providers.SQLITE) {
    return true
  }

  // if the provider is not included, skip
  if (includedProviders !== undefined && !includedProviders.includes(provider)) {
    return true
  }

  // if the provider is excluded, skip
  if (excludedProviders.includes(provider)) {
    return true
  }

  // if there is a Driver Adapter to run and it's not included, skip
  if (driverAdapter !== undefined && !includedProviderAdapters?.includes(driverAdapter)) {
    return true
  }

  // if this test can't use a driver adapter, and we run the tests for a specific
  // driver adapter, skip it
  if (driverAdapter === undefined && includedProviderAdapters !== undefined) {
    return true
  }

  // if there is a Driver Adapter to run and it's excluded, skip
  if (driverAdapter && excludedProviderFlavors.includes(driverAdapter)) {
    return true
  }

  // if the Driver Adapter is explicitly skipped in the matrix options, skip
  if (driverAdapter !== undefined && options?.skipDriverAdapter?.from.includes(driverAdapter)) {
    return true
  }

  // if there is a relation mode set and the Driver Adapter doesn't support it, skip
  if (
    driverAdapter !== undefined &&
    relationMode !== undefined &&
    relationModesForAdapter[driverAdapter] !== undefined &&
    relationMode !== relationModesForAdapter[driverAdapter]
  ) {
    return true
  }

  // if Driver Adapters are enabled and the test has no Driver Adapter, skip
  if (includedProviderAdapters !== undefined && driverAdapter === undefined) {
    return true
  }

  // if there's no adapter, skip
  if (driverAdapter === undefined && cliMeta.clientEngineExecutor === 'local') {
    return true
  }

  // if this test requires a specific client runtime which doesn't match the one we're testing for, skip
  if (clientRuntime !== undefined && clientRuntime !== cliMeta.runtime) {
    return true
  }

  // if this test requires a specific client engine executor in case a client engine is used,
  // and it doesn't match the one we're testing for, skip
  if (clientEngineExecutor !== undefined && clientEngineExecutor !== cliMeta.clientEngineExecutor) {
    return true
  }

  // if this test requires client engine's remote executor and we're not testing QC, skip
  if (clientEngineExecutor === 'remote' && clientRuntime !== 'client') {
    return true
  }

  return false
}

function buildPlanContext(): SuitePlanContext {
  return {
    includedProviders: process.env.ONLY_TEST_PROVIDERS?.split(','),
    includedProviderAdapters: process.env.ONLY_TEST_PROVIDER_ADAPTERS?.split(','),
    excludedProviders: getExclusionsFromEnv(excludeEnvToProviderMap),
    excludedDriverAdapters: getExclusionsFromEnv(excludeEnvToProviderFlavorMap),
    updateSnapshots: process.env.UPDATE_SNAPSHOTS as 'inline' | 'external' | undefined,
  }
}

const excludeEnvToProviderMap = {
  TEST_SKIP_MONGODB: 'mongodb',
  TEST_SKIP_MSSQL: 'sqlserver',
  TEST_SKIP_COCKROACHDB: 'cockroachdb',
  TEST_SKIP_POSTGRESQL: 'postgresql',
  TEST_SKIP_SQLITE: 'sqlite',
}

const excludeEnvToProviderFlavorMap = {
  TEST_SKIP_VITESS: AdapterProviders.VITESS_8,
  TEST_SKIP_PG: AdapterProviders.JS_PG,
  TEST_SKIP_NEON: AdapterProviders.JS_NEON,
  TEST_SKIP_PLANETSCALE: AdapterProviders.JS_PLANETSCALE,
  TEST_SKIP_LIBSQL: AdapterProviders.JS_LIBSQL,
  TEST_SKIP_D1: AdapterProviders.JS_D1,
  TEST_SKIP_BETTER_SQLITE3: AdapterProviders.JS_BETTER_SQLITE3,
  TEST_SKIP_MSSQL: AdapterProviders.JS_MSSQL,
  TEST_SKIP_MARIADB: AdapterProviders.JS_MARIADB,
  TEST_SKIP_PG_COCKROACHDB: AdapterProviders.JS_PG_COCKROACHDB,
}

function getExclusionsFromEnv(exclusionMap: Record<string, string>) {
  return Object.entries(exclusionMap).reduce((acc, [envVarName, exclusionName]) => {
    if (process.env[envVarName]) {
      acc.push(exclusionName.toLowerCase())
    }
    return acc
  }, [] as string[])
}
