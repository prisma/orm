import { RuntimeDataModel } from '@prisma/client-common'

import { GlobalOmitOptions } from '../jsonProtocol/serializeJsonQuery'
import { dmmfToJSModelName } from '../model/utils/dmmfToJSModelName'
import { JsArgs } from '../types/exported/JsApi'
import { applyResultExtensions } from './applyResultExtensions'
import { MergedExtensionsList } from './MergedExtensionsList'
import { visitQueryResult } from './visitQueryResult'

type ApplyAllResultExtensionsParams = {
  result: object | null
  modelName: string
  args: JsArgs
  extensions: MergedExtensionsList
  runtimeDataModel: RuntimeDataModel
  globalOmit?: GlobalOmitOptions
}

/**
 * Walks the result of the query and applies all possible result extensions
 * to all parts of it, including nested relations
 */
export function applyAllResultExtensions({
  result,
  modelName,
  args,
  extensions,
  runtimeDataModel,
  globalOmit,
}: ApplyAllResultExtensionsParams) {
  // We return the result directly (not applying result extensions) if
  // - no extension has a `result` component, so nothing can change the result
  // - result is `null`
  // - result is not an object (e.g. `.count()`)
  if (!extensions.hasResultExtension() || result == null || typeof result !== 'object') {
    return result
  }
  const model = runtimeDataModel.models[modelName]
  if (!model) {
    return result
  }

  return visitQueryResult({
    result,
    args: args ?? {},
    modelName,
    runtimeDataModel,
    visitor: (value, dmmfModelName, args) => {
      const jsName = dmmfToJSModelName(dmmfModelName)
      return applyResultExtensions({
        result: value,
        modelName: jsName,
        select: args.select,
        // passing omit only if explicit select is not set - those 2 options are
        // mutually exclusive
        omit: args.select ? undefined : { ...globalOmit?.[jsName], ...args.omit },
        extensions,
      })
    },
  })
}
