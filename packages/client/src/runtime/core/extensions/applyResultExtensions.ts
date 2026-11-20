import { hasOwnProperty } from '@prisma/internals'

import {
  addProperty,
  cacheProperties,
  CompositeProxyLayer,
  createCompositeProxy,
  removeProperties,
} from '../compositeProxy'
import { Omission, Selection } from '../types/exported/JsApi'
import { MergedExtensionsList } from './MergedExtensionsList'
import { ComputedField } from './resultUtils'

type ApplyExtensionsArgs = {
  result: object
  select?: Selection
  omit?: Omission
  modelName: string
  extensions: MergedExtensionsList
}

/**
 * Given a part of a query result, it's model name and a list of extension,
 * applies computed fields to the results. Fields are computed lazily on a first access,
 * after that the result of computation is cached. In case `select` is used, all dependencies
 * of the computed fields would be excluded from final result, unless they are also specified in the select.
 *
 * This function applies computed fields to a single object only: it does not traverse relationships.
 * For full functionality, it is meant to be combined with `visitQueryResult`.
 *
 * @param params
 * @returns
 */
export function applyResultExtensions({ result, modelName, select, omit, extensions }: ApplyExtensionsArgs) {
  const computedFields = extensions.getAllComputedFields(modelName)
  if (!computedFields) {
    return result
  }

  const computedPropertiesLayers: CompositeProxyLayer[] = []
  const maskingLayers: CompositeProxyLayer[] = []

  for (const field of Object.values(computedFields)) {
    if (omit) {
      if (omit[field.name]) {
        continue
      }
      const toMask = field.needs.filter((prop) => omit[prop])
      if (toMask.length > 0) {
        maskingLayers.push(removeProperties(toMask))
      }
    } else if (select) {
      if (!select[field.name]) {
        continue
      }

      const toMask = field.needs.filter((prop) => !select[prop])
      if (toMask.length > 0) {
        maskingLayers.push(removeProperties(toMask))
      }
    }

    if (areNeedsMet(result, field.needs)) {
      computedPropertiesLayers.push(
        computedPropertyLayer(field, createCompositeProxy(result, computedPropertiesLayers), modelName),
      )
    }
  }

  if (computedPropertiesLayers.length > 0 || maskingLayers.length > 0) {
    return createCompositeProxy(result, [...computedPropertiesLayers, ...maskingLayers])
  }
  return result
}

function areNeedsMet(result: object, neededProperties: string[]) {
  return neededProperties.every((property) => hasOwnProperty(result, property))
}

function computedPropertyLayer(field: ComputedField, result: object, modelName: string): CompositeProxyLayer {
  return cacheProperties(addProperty(field.name, () => field.compute(result, modelName)))
}
