import fs from 'fs/promises'
import path from 'path'

import { matrix } from '../../../../../helpers/blaze/matrix'
import { merge } from '../../../../../helpers/blaze/merge'
import { MatrixTestHelper } from './defineMatrix'
import { AdapterProviders, GeneratorTypes, isDriverAdapterProviderLabel, Providers, RelationModes } from './providers'
import { ClientEngineExecutor, ClientMeta, ClientRuntime, CliMeta } from './types'

export type TestSuiteMeta = ReturnType<typeof getTestSuiteMeta>

export type TestSuiteMatrix = { [K in string]: any }[][]
export type NamedTestSuiteConfig = {
  parametersString: string
  matrixOptions: Record<string, string> & {
    provider: Providers
    generatorType?: GeneratorTypes
    driverAdapter?: `${AdapterProviders}`
    relationMode?: `${RelationModes}`
    clientRuntime?: `${ClientRuntime}`
    previewFeatures?: string[]
    clientEngineExecutor?: ClientEngineExecutor
  }
}

type MatrixModule = (() => TestSuiteMatrix) | MatrixTestHelper<TestSuiteMatrix>

const allProvidersRegexUnion = Object.values(Providers).join('|')
const schemaPreviewFeaturesRegex = /previewFeatures\s*=\s*(.*)/
const schemaDefaultGeneratorRegex = /provider\s*=\s*"prisma-client(-(j|t)s)?"/
const schemaProviderRegex = new RegExp(`provider\\s*=\\s*"(?:${allProvidersRegexUnion})"`, 'g')
const schemaRelationModeRegex = /relationMode\s*=\s*".*"/

/**
 * Get the generated test suite name, used for the folder name.
 * @param suiteMeta
 * @param suiteConfig
 * @returns
 */
export function getTestSuiteFullName(suiteMeta: TestSuiteMeta, suiteConfig: NamedTestSuiteConfig) {
  let name = `${suiteMeta.testName.replace(/\\|\//g, '.')}`
  let parametersString = suiteConfig.parametersString

  const { clientEngineExecutor, clientRuntime } = suiteConfig.matrixOptions
  if (clientRuntime === 'client' && clientEngineExecutor === 'remote') {
    parametersString += ', qpe=remote'
  }

  name += ` (${parametersString})`

  // replace illegal chars with empty string
  return name.replace(/[<>:"\/\\|?*]/g, '')
}

/**
 * Get the generated test suite features, used for client generation.
 * @param suiteConfig
 * @returns
 */
export function getTestSuitePreviewFeatures(schema: string): string[] {
  const match = schema.match(schemaPreviewFeaturesRegex)

  return match === null ? [] : JSON.parse(match[1])
}

/**
 * Get the generated test suite path, where files will be copied to.
 */
export function getTestSuiteFolderPath({
  suiteMeta,
  suiteConfig,
}: {
  suiteMeta: TestSuiteMeta
  suiteConfig: NamedTestSuiteConfig
}) {
  const generatedFolder = path.join(suiteMeta.prismaPath, '..', '.generated')
  const suiteName = getTestSuiteFullName(suiteMeta, suiteConfig)
  const suiteFolder = path.join(generatedFolder, suiteName)

  return suiteFolder
}

/**
 * Get the generated test suite schema file path.
 */
export function getTestSuiteSchemaPath({
  suiteMeta,
  suiteConfig,
}: {
  suiteMeta: TestSuiteMeta
  suiteConfig: NamedTestSuiteConfig
}) {
  const prismaFolder = getTestSuitePrismaPath({ suiteMeta, suiteConfig })
  const schemaPath = path.join(prismaFolder, 'schema.prisma')

  return schemaPath
}

/**
 * Get the generated test suite prisma folder path.
 */
export function getTestSuitePrismaPath({
  suiteMeta,
  suiteConfig,
}: {
  suiteMeta: TestSuiteMeta
  suiteConfig: NamedTestSuiteConfig
}) {
  const suiteFolder = getTestSuiteFolderPath({ suiteMeta, suiteConfig })
  const prismaPath = path.join(suiteFolder, 'prisma')

  return prismaPath
}

/**
 * Transforms the `_matrix.ts` into the cross-product of config objects.
 * @param suiteMeta
 * @returns
 */
export function getTestSuiteConfigs(suiteMeta: TestSuiteMeta) {
  const matrixModule = require(suiteMeta._matrixPath).default as MatrixModule

  let rawMatrix: TestSuiteMatrix
  let exclude: (config: Record<string, string>) => boolean

  if (typeof matrixModule === 'function') {
    rawMatrix = matrixModule()
    exclude = () => false
  } else {
    rawMatrix = matrixModule.matrix()
    exclude = matrixModule.matrixOptions?.exclude ?? (() => false)
  }

  const configs = matrix(rawMatrix)
    .map((configs) => ({
      parametersString: getTestSuiteParametersString(configs),
      matrixOptions: merge(configs),
    }))
    .filter(({ matrixOptions }) => !exclude(matrixOptions))

  return configs as NamedTestSuiteConfig[]
}

/**
 * Returns "parameters string" part of the suite name
 * - From each matrix dimension takes first key-value pair. Assumption is that first pair
 * is what really distinguishes this particular suite and the rest are just additional options, related to that
 * parameter and do need to be part of the suite name.
 * - Computes "key1=value1,key2=value2" string from each dimension of the matrix
 * @param configs
 * @returns
 */
function getTestSuiteParametersString(configs: Record<string, string>[]) {
  return configs
    .map((config) => {
      // Note: if the name is too long tests will fail with
      // `ENAMETOOLONG: name too long` as this is used for the directory name

      // For `relationMode` tests
      // we hardcode how it looks like for test results
      if (config.relationMode !== undefined) {
        const driverAdapterStr = config.driverAdapter === undefined ? '' : `driverAdapter=${config.driverAdapter},`
        return `relationMode=${config.relationMode},provider=${config.provider},${driverAdapterStr}onUpdate=${config.onUpdate},onDelete=${config.onDelete},id=${config.id}`
      } else {
        const firstKey = Object.keys(config)[0] // ! TODO this can actually produce incorrect tests and break type checks ! \\ Replace with hash
        return `${firstKey}=${config[firstKey]}`
      }
    })
    .join(', ')
}

/**
 * Inflate the base schema with a test suite config, used for schema generation.
 */
export function getTestSuiteSchema({
  cliMeta,
  suiteMeta,
  matrixOptions,
}: {
  cliMeta: CliMeta
  suiteMeta: TestSuiteMeta
  matrixOptions: NamedTestSuiteConfig['matrixOptions']
}) {
  let schema = require(suiteMeta._schemaPath).default(matrixOptions) as string
  const previewFeatureMatch = schema.match(schemaPreviewFeaturesRegex)
  const defaultGeneratorMatch = schema.match(schemaDefaultGeneratorRegex)
  const prismaRelationModeMatch = schema.match(schemaRelationModeRegex)
  const providerMatch = schema.match(schemaProviderRegex)
  const previewFeatures = getTestSuitePreviewFeatures(schema)

  const { engineType, relationMode } = matrixOptions

  // By default, mini-proxy distinguishes different engine instances using
  // inline schema hash. In case 2 tests are running in parallel with identical
  // schema, this can cause all kinds of problems. Adding a unique comment at
  // the top of schema file forces them to have different hash and fixes this.
  schema = `// ${JSON.stringify({ test: suiteMeta.testPath, matrixOptions })}\n${schema}`

  // in some cases we may add more preview features automatically to the schema
  previewFeatures.push(...cliMeta.previewFeatures)
  const previewFeaturesStr = `previewFeatures = ${JSON.stringify(previewFeatures)}`

  // if there's already a preview features block, replace it with the updated one
  if (previewFeatureMatch !== null) {
    schema = schema.replace(previewFeatureMatch[0], previewFeaturesStr)
  }

  // if there's no preview features, append them to the default generator block
  if (previewFeatureMatch === null && defaultGeneratorMatch !== null) {
    const replacement = `${defaultGeneratorMatch[0]}\n${previewFeaturesStr}`
    schema = schema.replace(defaultGeneratorMatch[0], replacement)
  }

  // if an engine type is specified, append it to the default generator block
  if (engineType !== undefined && defaultGeneratorMatch !== null) {
    const replacement = `${defaultGeneratorMatch[0]}\nengineType = "${engineType}"`
    schema = schema.replace(defaultGeneratorMatch[0], replacement)
  }

  // for PlanetScale and Vitess, we need to add `relationMode = "prisma"` to the schema
  if (matrixOptions.relationMode && providerMatch !== null) {
    const replacement = `${providerMatch![0]}\nrelationMode = "${relationMode}"`

    if (prismaRelationModeMatch === null) {
      schema = schema.replace(providerMatch[0], replacement)
    }
  }

  // update the generator block to use the correct generator type
  if (defaultGeneratorMatch !== null && matrixOptions.generatorType !== undefined) {
    const replacement = `provider = "${matrixOptions.generatorType}"`
    schema = schema.replace(defaultGeneratorMatch[0], replacement)
  }

  return schema
}

/**
 * Get metadata about the original test suite executed by jest.
 * @returns
 */
export function getTestSuiteMeta() {
  const testsDir = path.join(path.dirname(__dirname), '/')
  const testPath = expect.getState().testPath
  if (testPath === undefined) {
    throw new Error(`getTestSuiteMeta can be executed only within jest test`)
  }
  const testRootDirName = path.parse(testPath.replace(testsDir, '')).dir
  const testRoot = path.join(testsDir, testRootDirName)
  const rootRelativeTestPath = path.relative(testRoot, testPath)
  const rootRelativeTestDir = path.dirname(rootRelativeTestPath)
  let testName: string
  if (rootRelativeTestPath === 'tests.ts') {
    testName = testRootDirName
  } else {
    testName = path.join(testRootDirName, rootRelativeTestDir, path.basename(testPath, '.ts'))
  }
  const testFileName = path.basename(testPath)
  const prismaPath = path.join(testRoot, 'prisma')
  const _matrixPath = path.join(testRoot, '_matrix')
  const _schemaPath = path.join(prismaPath, '_schema')
  const sqlPath = path.join(prismaPath, 'sql')

  return {
    testName,
    testPath,
    testRoot,
    rootRelativeTestPath,
    rootRelativeTestDir,
    testFileName,
    prismaPath,
    sqlPath,
    _matrixPath,
    _schemaPath,
  }
}

/**
 * Get `TestCliMeta` from the environment variables created by the test CLI.
 */
export function getTestSuiteCliMeta(): CliMeta {
  const dataProxy = Boolean(process.env.TEST_DATA_PROXY)
  const runtime = process.env.TEST_CLIENT_RUNTIME as ClientRuntime | undefined
  const previewFeatures = process.env.TEST_PREVIEW_FEATURES ?? ''
  const generatorType = process.env.TEST_GENERATOR_TYPE as GeneratorTypes | undefined
  const clientEngineExecutor = process.env.TEST_CLIENT_ENGINE_REMOTE_EXECUTOR ? 'remote' : 'local'

  return {
    dataProxy,
    runtime: runtime ?? 'client',
    previewFeatures: previewFeatures.split(',').filter((feature) => feature !== ''),
    generatorType,
    clientEngineExecutor,
  }
}

/**
 * Get `ClientMeta` information to be passed down into the test suite.
 */
export function getTestSuiteClientMeta({
  suiteConfig,
}: {
  suiteConfig: NamedTestSuiteConfig['matrixOptions']
}): ClientMeta {
  return {
    ...getTestSuiteCliMeta(),
    driverAdapter: isDriverAdapterProviderLabel(suiteConfig.driverAdapter),
  }
}

export async function testSuiteHasTypedSql(meta: TestSuiteMeta) {
  return await isDirectory(meta.sqlPath)
}

async function isDirectory(path: string) {
  try {
    const stat = await fs.stat(path)
    return stat.isDirectory()
  } catch (e) {
    if (e.code === 'ENOENT') {
      return false
    }
    throw e
  }
}
