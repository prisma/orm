import { Cache } from '@prisma/client-common'
import { mapObjectValues } from '@prisma/internals'

import { dmmfToJSModelName } from '../model/utils/dmmfToJSModelName'
import { ExtensionArgs, ResultArg, ResultArgsFieldCompute } from '../types/exported/ExtensionArgs'
import { Omission, Selection } from '../types/exported/JsApi'

export type ComputedField = {
  name: string
  needs: string[]
  compute: ResultArgsFieldCompute
}

export type ComputedFieldsMap = {
  [fieldName: string]: ComputedField
}

/**
 * Given the list of previously resolved computed fields, new extension and dmmf model name, produces a map
 * of all computed fields that may be applied to this model, accounting for all previous and past extensions.
 *
 * All naming conflicts which could be produced by the plain list of extensions are resolved as follows:
 * - extension, that declared later always wins
 * - in a single extension, specific model takes precedence over $allModels
 *
 * Additionally, resolves all `needs` dependencies down to the model fields. For example,
 * if `nameAndTitle` field depends on `fullName` computed field and `title` model field and
 * `fullName` field depends on `firstName` and `lastName` field, full list of `nameAndTitle` dependencies
 * would be `firstName`, `lastName`, `title`.
 * @param previousComputedFields
 * @param extension
 * @param dmmfModelName
 * @returns
 */
export function getComputedFields(
  previousComputedFields: ComputedFieldsMap | undefined,
  extension: ExtensionArgs,
  dmmfModelName: string,
) {
  const jsName = dmmfToJSModelName(dmmfModelName)
  if (!extension.result || !(extension.result.$allModels || extension.result[jsName])) {
    return previousComputedFields
  }

  return resolveDependencies({
    ...previousComputedFields,
    ...getComputedFieldsFromModel(extension.name, previousComputedFields, extension.result.$allModels),
    ...getComputedFieldsFromModel(extension.name, previousComputedFields, extension.result[jsName]),
  })
}

export function resolveDependencies(computedFields: ComputedFieldsMap): ComputedFieldsMap {
  const cache = new Cache<string, string[]>()
  const resolveNeeds = (fieldName: string, visitedFields: Set<string>) => {
    return cache.getOrCreate(fieldName, () => {
      if (visitedFields.has(fieldName)) {
        return [fieldName]
      }
      visitedFields.add(fieldName)
      if (!computedFields[fieldName]) {
        return [fieldName]
      }
      return computedFields[fieldName].needs.flatMap((fieldDep) => resolveNeeds(fieldDep, visitedFields))
    })
  }

  return mapObjectValues(computedFields, (field) => {
    return {
      ...field,
      needs: resolveNeeds(field.name, new Set()),
    }
  })
}

function getComputedFieldsFromModel(
  name: string | undefined,
  previousComputedFields: ComputedFieldsMap | undefined,
  modelResult: ResultArg | undefined,
): ComputedFieldsMap {
  if (!modelResult) {
    return {}
  }

  return mapObjectValues(modelResult, ({ needs, compute }, fieldName) => ({
    name: fieldName,
    needs: needs ? Object.keys(needs).filter((key) => needs[key]) : [],
    compute: composeCompute(previousComputedFields, fieldName, compute),
  }))
}

function composeCompute(
  previousComputedFields: ComputedFieldsMap | undefined,
  fieldName: string,
  nextCompute: ResultArgsFieldCompute,
): ResultArgsFieldCompute {
  const previousCompute = previousComputedFields?.[fieldName]?.compute
  if (!previousCompute) {
    return nextCompute
  }
  return (model, modelName) => {
    return nextCompute({ ...model, [fieldName]: previousCompute(model, modelName) }, modelName)
  }
}

export function computeEngineSideSelection(
  selection: Selection,
  computedFields: ComputedFieldsMap | undefined,
): Selection {
  if (!computedFields) {
    return selection
  }
  const result = { ...selection }

  for (const field of Object.values(computedFields)) {
    if (!selection[field.name]) {
      continue
    }

    for (const dependency of field.needs) {
      result[dependency] = true
    }
  }
  return result
}

/**
 * Given user-supplied omissions, computes the results to send to the engine, taking
 * into account dependencies of the computed field. Consider following example:
 *
 * ```
 * const xprisma = prisma.$extends({
 *       result: {
 *         user: {
 *           sanitizedPassword: {
 *             needs: { password: true },
 *             compute(user) {
 *               return sanitze(user.password)
 *             },
 *           },
 *         },
 *       },
 * })
 *
 * const user = await xprisma.user.findFirstOrThrow({
 *       omit: {
 *         password: true,
 *       },
 * })
 * ```
 *
 * In that case, user wants to omit the `password` but not `sanitizedPassword`.
 * Since `sanitizedPassword` can not be computed without `password`, we can not let
 * the engine handle omission in this case - we have to still query `password` from the
 * database and omit it on the client, after computing `sanitizedPassword`.
 *
 * This function removes the omission (thus, including the field into result set) if it is a dependency of
 * a non-omitted computed field. Client-side omission after we get a response is handled by `applyResultExtensions`
 *
 * @param omission
 * @param computedFields
 * @returns
 */
export function computeEngineSideOmissions(
  omission: Omission,
  computedFields: ComputedFieldsMap | undefined,
): Omission {
  if (!computedFields) {
    return omission
  }
  const result = { ...omission }

  for (const field of Object.values(computedFields)) {
    if (omission[field.name]) {
      continue
    }

    for (const dependency of field.needs) {
      delete result[dependency]
    }
  }
  return result
}
