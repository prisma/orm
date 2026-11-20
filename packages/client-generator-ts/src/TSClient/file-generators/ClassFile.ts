import { GetPrismaClientConfig } from '@prisma/client-common'
import * as DMMF from '@prisma/dmmf'
import { buildAndSerializeParamGraph } from '@prisma/param-graph-builder'
import * as ts from '@prisma/ts-builders'

import { buildDebugInitialization } from '../../utils/buildDebugInitialization'
import { buildRuntimeDataModel } from '../../utils/buildDMMF'
import { buildGetWasmModule } from '../../utils/wasm'
import { GenerateContext } from '../GenerateContext'
import { PrismaClientClass } from '../PrismaClient'
import { TSClientOptions } from '../TSClient'

const jsDocHeader = `/*
 * WARNING: This is an internal file that is subject to change!
 *
 * 🛑 Under no circumstances should you import this file directly! 🛑
 *
 * Please import the \`PrismaClient\` class from the \`client.ts\` file instead.
 */
`

export function createClassFile(context: GenerateContext, options: TSClientOptions): string {
  const imports: ts.BasicBuilder[] = [
    ts.moduleImport(context.runtimeImport).asNamespace('runtime'),
    ts.moduleImport(context.importFileName(`./prismaNamespace`)).asNamespace('Prisma').typeOnly(),
  ]

  const stringifiedImports = imports.map((i) => ts.stringify(i))

  const prismaClientClass = new PrismaClientClass(context, options.runtimeName)

  return `${jsDocHeader}
${stringifiedImports.join('\n')}

${clientConfig(context, options)}

${prismaClientClass.toTS()}

export function getPrismaClientClass(): PrismaClientConstructor {
  return runtime.getPrismaClient(config) as unknown as PrismaClientConstructor
}
`
}

function clientConfig(context: GenerateContext, options: TSClientOptions) {
  const {
    edge,
    generator,
    datamodel: inlineSchema,
    runtimeBase,
    runtimeName,
    target,
    activeProvider,
    moduleFormat,
    compilerBuild,
    dmmf,
  } = options

  const config: GetPrismaClientConfig = {
    previewFeatures: generator.previewFeatures,
    clientVersion: options.clientVersion,
    engineVersion: options.engineVersion,
    activeProvider: options.activeProvider,
    inlineSchema,
    runtimeDataModel: { models: {}, enums: {}, types: {} },
    parameterizationSchema: { strings: [], graph: '' },
  }

  return `
const config: runtime.GetPrismaClientConfig = ${JSON.stringify(config, null, 2)}
${buildRuntimeDataModel(context.dmmf.datamodel, runtimeName)}
${buildParameterizationSchema(dmmf)}
${buildGetWasmModule({ runtimeBase, runtimeName, target, activeProvider, moduleFormat, compilerBuild })}
${buildDebugInitialization(edge)}
`
}

function buildParameterizationSchema(dmmf: DMMF.Document): string {
  const serialized = buildAndSerializeParamGraph(dmmf)
  const stringsJson = JSON.stringify(JSON.stringify(serialized.strings))
  return `config.parameterizationSchema = {
  strings: JSON.parse(${stringsJson}),
  graph: "${serialized.graph}"
}`
}
