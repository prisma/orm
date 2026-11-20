import type * as DMMF from '@prisma/dmmf'

export type RuntimeModel = Omit<DMMF.Model, 'name'>
export type RuntimeEnum = Omit<DMMF.DatamodelEnum, 'name'>

export type RuntimeDataModel = {
  readonly models: Record<string, RuntimeModel>
  readonly enums: Record<string, RuntimeEnum>
  readonly types: Record<string, RuntimeModel>
}

export type PrunedRuntimeModel = {
  readonly dbName: RuntimeModel['dbName']
  readonly schema: RuntimeModel['schema']
  readonly fields: Pick<RuntimeModel['fields'][number], 'name' | 'kind' | 'type' | 'relationName' | 'dbName'>[]
}

export type PrunedRuntimeDataModel = {
  readonly models: Record<string, PrunedRuntimeModel>
  readonly enums: {}
  readonly types: {}
}

export function dmmfToRuntimeDataModel(dmmfDataModel: DMMF.Datamodel): RuntimeDataModel {
  return {
    models: buildMapForRuntime(dmmfDataModel.models),
    enums: buildMapForRuntime(dmmfDataModel.enums),
    types: buildMapForRuntime(dmmfDataModel.types),
  }
}

/**
 * Minimal version of the runtime datamodel for the Client to work
 * @param runtimeDataModel
 * @returns
 */
export function pruneRuntimeDataModel({ models }: RuntimeDataModel) {
  const prunedModels: PrunedRuntimeDataModel['models'] = {}

  for (const modelName of Object.keys(models)) {
    prunedModels[modelName] = { fields: [], dbName: models[modelName].dbName, schema: models[modelName].schema }

    for (const { name, kind, type, relationName, dbName } of models[modelName].fields) {
      prunedModels[modelName].fields.push({ name, kind, type, relationName, dbName })
    }
  }

  return { models: prunedModels, enums: {}, types: {} }
}

function buildMapForRuntime<T extends { name: string }>(list: readonly T[]): Record<string, Omit<T, 'name'>> {
  const result: Record<string, Omit<T, 'name'>> = {}
  for (const { name, ...rest } of list) {
    result[name] = rest
  }
  return result
}
