import { dmmfToRuntimeDataModel, GetPrismaClientConfig } from '@prisma/client-common'
import { getDMMF } from '@prisma/client-generator-js'
import { BuiltInProvider, getConfig, getSchemaWithPath, parseEnvValue, printConfigWarnings } from '@prisma/internals'
import { buildAndSerializeParamGraph } from '@prisma/param-graph-builder'
import path from 'path'
import { parse } from 'stacktrace-parser'

import { getPrismaClient } from '../runtime/getPrismaClient'
import { generateInFolder } from './generateInFolder'

const runtimeBase = path.join(__dirname, '..', '..', 'runtime')

//TODO Rename to generateTestClientInMemory
/**
 * Returns an in-memory client for testing
 */
export async function getTestClient(schemaDir?: string, printWarnings?: boolean): Promise<any> {
  const callSite = path.dirname(require.main?.filename ?? '')
  const absSchemaDir = path.resolve(callSite, schemaDir ?? '')

  const { schemas: datamodel } = (await getSchemaWithPath({
    schemaPath: { baseDir: absSchemaDir },
    cwd: absSchemaDir,
  }))!

  const config = await getConfig({ datamodel })
  if (printWarnings) {
    printConfigWarnings(config.warnings)
  }

  const generator = config.generators.find((g) => parseEnvValue(g.provider) === BuiltInProvider.PrismaClientJs)
  ;(global as any).TARGET_BUILD_TYPE = 'client'

  const document = await getDMMF({ datamodel })
  const activeProvider = config.datasources[0].activeProvider
  const options: GetPrismaClientConfig = {
    runtimeDataModel: dmmfToRuntimeDataModel(document.datamodel),
    previewFeatures: generator?.previewFeatures ?? [],
    clientVersion: '0.0.0',
    engineVersion: '0000000000000000000000000000000000000000',
    activeProvider,
    inlineSchema: datamodel[0][1], // TODO: merge schemas
    compilerWasm: {
      getRuntime: () => Promise.resolve(require(path.join(runtimeBase, `query_compiler_fast_bg.${activeProvider}.js`))),
      getQueryCompilerWasmModule: () => {
        const queryCompilerWasmFilePath = path.join(
          runtimeBase,
          `query_compiler_fast_bg.${activeProvider}.wasm-base64.js`,
        )
        const wasmBase64: string = require(queryCompilerWasmFilePath).wasm
        return Promise.resolve(new WebAssembly.Module(Buffer.from(wasmBase64, 'base64')))
      },
      importName: './query_compiler_fast_bg.js',
    },
    parameterizationSchema: buildAndSerializeParamGraph(document),
  }

  return getPrismaClient(options)
}

/**
 * Options of `generateTestClient` function.
 */
type GenerateTestClientOptions = {
  /**
   * Directory to search for the schema in and generate the client in.
   */
  projectDir?: string
}

/**
 * Actually generates a test client into ./@prisma/client
 */
export async function generateTestClient({ projectDir }: GenerateTestClientOptions = {}): Promise<any> {
  if (!projectDir) {
    const callsite = parse(new Error('').stack!)
    projectDir = path.dirname(callsite[1].file!)
  }

  await generateInFolder({
    projectDir,
  })
}
