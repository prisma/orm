import { RuntimeDataModel } from '@prisma/client-common'

import { JsArgs } from '../types/exported/JsApi'

type ResolveResultExtensionContextParams = {
  dataPath: string[]
  modelName: string
  args?: JsArgs
  runtimeDataModel: RuntimeDataModel
}

type ResultExtensionContext = {
  modelName: string
  args: JsArgs
}

/**
 * Resolves the model/args context used for result extensions from a query dataPath.
 * Falls back to the root model context when traversal can not continue because the model is
 * missing, the segment is not a relation, or the path format is invalid.
 * Throws when a relation field segment from dataPath does not exist on the current model.
 */
export function resolveResultExtensionContext({
  dataPath,
  modelName,
  args,
  runtimeDataModel,
}: ResolveResultExtensionContextParams): ResultExtensionContext {
  const rootContext = {
    modelName,
    args: args ?? {},
  }

  const relationPath = relationPathFromDataPath(dataPath)
  if (!relationPath || relationPath.length === 0) {
    return rootContext
  }

  let currentModelName = modelName
  let currentArgs: JsArgs = args ?? {}

  for (const relationFieldName of relationPath) {
    const currentModel = runtimeDataModel.models[currentModelName]
    if (!currentModel) {
      return rootContext
    }

    const relationField = currentModel.fields.find((field) => field.name === relationFieldName)
    if (!relationField) {
      throw new Error(
        `Could not resolve relation field "${relationFieldName}" on model "${currentModelName}" from dataPath "${dataPath.join('.')}"`,
      )
    }
    if (relationField.kind !== 'object' || !relationField.relationName) {
      return rootContext
    }

    currentModelName = relationField.type
    currentArgs = resolveNextArgs(currentArgs, relationFieldName)
  }

  return {
    modelName: currentModelName,
    args: currentArgs,
  }
}

function relationPathFromDataPath(dataPath: string[]): string[] | undefined {
  const relationPath: string[] = []

  for (let index = 0; index < dataPath.length; index += 2) {
    const selector = dataPath[index]
    const relationFieldName = dataPath[index + 1]

    if ((selector !== 'select' && selector !== 'include') || relationFieldName === undefined) {
      return undefined
    }

    relationPath.push(relationFieldName)
  }

  return relationPath
}

function resolveNextArgs(args: JsArgs, relationFieldName: string): JsArgs {
  const select = args.select?.[relationFieldName]
  if (isNestedArgs(select)) {
    return select
  }

  const include = args.include?.[relationFieldName]
  if (isNestedArgs(include)) {
    return include
  }

  return {}
}

function isNestedArgs(value: unknown): value is JsArgs {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
