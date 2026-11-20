import {
  dmmfToRuntimeDataModel,
  PrunedRuntimeDataModel,
  pruneRuntimeDataModel,
  RuntimeDataModel,
} from '@prisma/client-common'
import type * as DMMF from '@prisma/dmmf'

import { escapeJson } from '../TSClient/helpers'
import { TSClientOptions } from '../TSClient/TSClient'

/**
 * Given DMMF models, computes runtime datamodel from it and embeds
 * it into generated client.
 */
export function buildRuntimeDataModel(datamodel: DMMF.Datamodel, runtimeName: TSClientOptions['runtimeName']) {
  const runtimeDataModel = dmmfToRuntimeDataModel(datamodel)

  let prunedDataModel: PrunedRuntimeDataModel | RuntimeDataModel
  if (runtimeName === 'wasm-compiler-edge' || runtimeName === 'client') {
    prunedDataModel = pruneRuntimeDataModel(runtimeDataModel)
  } else {
    prunedDataModel = runtimeDataModel
  }
  const datamodelString = escapeJson(JSON.stringify(prunedDataModel))

  return `
config.runtimeDataModel = JSON.parse(${JSON.stringify(datamodelString)})`
}
