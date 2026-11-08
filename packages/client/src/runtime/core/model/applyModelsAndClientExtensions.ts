import type { RuntimeDataModel } from '@prisma/client-common'

import type { Client } from '../../getPrismaClient'
import {
  addObjectProperties,
  addProperty,
  cacheProperties,
  CompositeProxyLayer,
  createCompositeProxy,
} from '../compositeProxy'
import { applyModel } from './applyModel'
import { dmmfToJSModelName } from './utils/dmmfToJSModelName'
import { jsToDMMFModelName } from './utils/jsToDMMFModelName'

// symbol we use for storing raw, unproxied
// client instance, so we later can retrieve it
// via `unapplyModels` methods
const rawClient = Symbol()

// Generated data models are shared by client instances and extensions. Only
// schema-derived keys can be shared; model proxies must stay local to each client.
const modelKeysCache = new WeakMap<RuntimeDataModel, { jsModelKeys: string[]; allKeys: string[] }>()

/**
 * Dynamically creates a model proxy interface for a give name. For each prop
 * accessed on this proxy, it will lookup the dmmf to find if that model exists.
 * If it is the case, it will create a proxy for that model via {@link applyModel}.
 * @param client to create the proxy around
 * @returns a proxy to access models
 */
export function applyModelsAndClientExtensions(client: Client) {
  const layers = [
    rootLayer(client),
    modelsLayer(client),
    addProperty(rawClient, () => client),
    addProperty('$parent', () => client._appliedParent),
  ]
  const clientExtensions = client._extensions.getAllClientExtensions()
  if (clientExtensions) {
    layers.push(addObjectProperties(clientExtensions))
  }
  return createCompositeProxy(client, layers)
}

function rootLayer(client: Client): CompositeProxyLayer {
  const prototype = Object.getPrototypeOf(client._originalClient)
  const allKeys = [...new Set(Object.getOwnPropertyNames(prototype))]

  return {
    getKeys() {
      return allKeys
    },

    getPropertyValue(prop) {
      return client[prop]
    },
  }
}

function modelsLayer(client: Client): CompositeProxyLayer {
  let modelKeys = modelKeysCache.get(client._runtimeDataModel)
  if (modelKeys === undefined) {
    const dmmfModelKeys = Object.keys(client._runtimeDataModel.models)
    const jsModelKeys = dmmfModelKeys.map(dmmfToJSModelName)
    modelKeys = { jsModelKeys, allKeys: [...new Set(dmmfModelKeys.concat(jsModelKeys))] }
    modelKeysCache.set(client._runtimeDataModel, modelKeys)
  }
  const { jsModelKeys, allKeys } = modelKeys

  return cacheProperties({
    getKeys() {
      return allKeys
    },

    getPropertyValue(prop) {
      const dmmfModelName = jsToDMMFModelName(prop)
      // creates a new model proxy on the fly and caches it
      if (client._runtimeDataModel.models[dmmfModelName] !== undefined) {
        return applyModel(client, dmmfModelName)
      }

      // above silently failed if model name is lower cased
      if (client._runtimeDataModel.models[prop] !== undefined) {
        return applyModel(client, prop)
      }

      return undefined
    },

    getPropertyDescriptor(key) {
      if (!jsModelKeys.includes(key)) {
        return { enumerable: false }
      }

      return undefined
    },
  })
}

export function unApplyModelsAndClientExtensions(client: Client): Client {
  if (client[rawClient]) {
    return client[rawClient]
  }
  return client
}
