import { ActiveConnectorType } from '@prisma/generator'
import type { SerializedParamGraph } from '@prisma/param-graph'

import { CompilerWasmLoadingConfig } from './QueryCompiler'
import { RuntimeDataModel } from './runtimeDataModel'

/**
 * Config that is stored into the generated client. When the generated client is
 * loaded, this same config is passed to {@link getPrismaClient} which creates a
 * closure with that config around a non-instantiated [[PrismaClient]].
 */
export type GetPrismaClientConfig = {
  runtimeDataModel: RuntimeDataModel
  previewFeatures: string[]
  clientVersion: string
  engineVersion: string
  activeProvider: ActiveConnectorType

  /**
   * The contents of the schema encoded into a string
   */
  inlineSchema: string

  /**
   * Optional wasm loading configuration
   */
  compilerWasm?: CompilerWasmLoadingConfig

  /**
   * Parameterization schema for schema-aware query parameterization.
   * Enables precise parameterization based on DMMF metadata.
   */
  parameterizationSchema: SerializedParamGraph
}
