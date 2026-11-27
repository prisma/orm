import type { RuntimeDataModel } from '@prisma/client-common'

import { modelNameForTable } from './modelNameForTable'

/**
 * Builds the `meta` object for a `PrismaClientKnownRequestError`.
 *
 * P2002 errors carry the physical name of the table the violated constraint
 * belongs to (`meta.table`, extracted by the driver adapters). It is mapped
 * back to the Prisma model name so that `meta.modelName` points at the model
 * where the violation actually occurred — which for nested writes is not
 * necessarily the model of the top-level operation — and the internal
 * `table` key is dropped from the user-facing meta.
 */
export function resolveErrorMeta(
  runtimeDataModel: RuntimeDataModel,
  errorMeta: Record<string, unknown> | undefined,
  errorCode: string,
  topLevelModelName: string | undefined,
): Record<string, unknown> | undefined {
  if (errorCode !== 'P2002' || typeof errorMeta?.table !== 'string') {
    return topLevelModelName ? { modelName: topLevelModelName, ...errorMeta } : errorMeta
  }

  const meta: Record<string, unknown> = { ...errorMeta }
  delete meta.table

  const modelName =
    modelNameForTable(runtimeDataModel, errorMeta.table) ??
    (typeof meta.modelName === 'string' ? meta.modelName : topLevelModelName)

  return modelName !== undefined ? { ...meta, modelName } : meta
}
