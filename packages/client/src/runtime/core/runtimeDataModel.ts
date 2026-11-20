import { BaseDMMF, lazyProperty, RuntimeDataModel } from '@prisma/client-common'

export function defineDmmfProperty(target: object, runtimeDataModel: RuntimeDataModel) {
  const dmmfLazy = lazyProperty(() => runtimeDataModelToBaseDmmf(runtimeDataModel))

  Object.defineProperty(target, 'dmmf', {
    get: () => dmmfLazy.get(),
  })
}

function runtimeDataModelToBaseDmmf(runtimeDataModel: RuntimeDataModel): BaseDMMF {
  if (TARGET_BUILD_TYPE === 'wasm-compiler-edge') {
    throw new Error('Prisma.dmmf is not available when running in edge runtimes.')
  }

  return {
    datamodel: {
      models: buildDMMFList(runtimeDataModel.models),
      enums: buildDMMFList(runtimeDataModel.enums),
      types: buildDMMFList(runtimeDataModel.types),
    },
  }
}

function buildDMMFList<T>(map: Record<string, T>): Array<T & { name: string }> {
  return Object.entries(map).map(([name, props]) => ({ name, ...props }))
}
