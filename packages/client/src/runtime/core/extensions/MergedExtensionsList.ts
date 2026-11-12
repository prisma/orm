import { Cache, lazyProperty } from '@prisma/client-common'

import { dmmfToJSModelName } from '../model/utils/dmmfToJSModelName'
import { ClientArg, ExtensionArgs, ModelArg, QueryOptionsCb } from '../types/exported/ExtensionArgs'
import { BatchQueryOptionsCb, QueryOptionsPrivate } from '../types/internal/ExtensionsInternalArgs'
import { ComputedFieldsMap, getComputedFields } from './resultUtils'

class MergedExtensionsListNode {
  private computedFieldsCache = new Cache<string, ComputedFieldsMap | undefined>()
  private modelExtensionsCache = new Cache<string, ModelArg | undefined>()
  private queryCallbacksCache = new Cache<string, QueryOptionsCb[]>()

  private clientExtensions = lazyProperty(() => {
    if (!this.extension.client) {
      return this.previous?.getAllClientExtensions()
    }

    return {
      ...this.previous?.getAllClientExtensions(),
      ...this.extension.client,
    }
  })

  private batchCallbacks = lazyProperty(() => {
    const previous: BatchQueryOptionsCb[] = this.previous?.getAllBatchQueryCallbacks() ?? []
    const newCb = (this.extension as QueryOptionsPrivate).query?.$__internalBatch
    if (!newCb) {
      return previous
    }
    return previous.concat(newCb)
  })

  private resultExtensionPresent = lazyProperty(
    () => Boolean(this.extension.result) || (this.previous?.hasResultExtension() ?? false),
  )

  constructor(
    public extension: ExtensionArgs,
    public previous?: MergedExtensionsListNode,
  ) {}

  hasResultExtension(): boolean {
    return this.resultExtensionPresent.get()
  }

  getAllComputedFields(dmmfModelName: string): ComputedFieldsMap | undefined {
    return this.computedFieldsCache.getOrCreate(dmmfModelName, () => {
      return getComputedFields(this.previous?.getAllComputedFields(dmmfModelName), this.extension, dmmfModelName)
    })
  }

  getAllClientExtensions(): ClientArg | undefined {
    return this.clientExtensions.get()
  }

  getAllModelExtensions(dmmfModelName: string): ModelArg | undefined {
    return this.modelExtensionsCache.getOrCreate(dmmfModelName, () => {
      const jsModelName = dmmfToJSModelName(dmmfModelName)
      if (!this.extension.model || !(this.extension.model[jsModelName] || this.extension.model.$allModels)) {
        return this.previous?.getAllModelExtensions(dmmfModelName)
      }

      return {
        ...this.previous?.getAllModelExtensions(dmmfModelName),
        ...this.extension.model.$allModels,
        ...this.extension.model[jsModelName],
      }
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  getAllQueryCallbacks(jsModelName: string | '$none', operation: string) {
    return this.queryCallbacksCache.getOrCreate(`${jsModelName}:${operation}`, () => {
      const prevCbs = this.previous?.getAllQueryCallbacks(jsModelName, operation) ?? []
      const newCbs: QueryOptionsCb[] = []
      const query = this.extension.query

      if (!query || !(query[jsModelName] || query['$allModels'] || query[operation] || query['$allOperations'])) {
        return prevCbs
      }

      if (query[jsModelName] !== undefined) {
        if (query[jsModelName][operation] !== undefined) {
          newCbs.push(query[jsModelName][operation])
        }

        // when the model-bound extension has a wildcard for the operation
        if (query[jsModelName]['$allOperations'] !== undefined) {
          newCbs.push(query[jsModelName]['$allOperations'])
        }
      }

      // when the extension isn't model-bound, apply it to all models
      // '$none' is a special case for top-level operations without model
      if (jsModelName !== '$none' && query['$allModels'] !== undefined) {
        if (query['$allModels'][operation] !== undefined) {
          newCbs.push(query['$allModels'][operation])
        }

        // when the non-model-bound extension has a wildcard for the operation
        if (query['$allModels']['$allOperations'] !== undefined) {
          newCbs.push(query['$allModels']['$allOperations'])
        }
      }

      // when the extension is not bound to a model & is a top-level operation
      if (query[operation] !== undefined) {
        newCbs.push(query[operation] as QueryOptionsCb)
      }

      // when the extension is not bound to a model & is any top-level operation
      if (query['$allOperations'] !== undefined) {
        newCbs.push(query['$allOperations'] as QueryOptionsCb)
      }

      return prevCbs.concat(newCbs)
    })
  }

  getAllBatchQueryCallbacks() {
    return this.batchCallbacks.get()
  }
}

/**
 * Class that holds the list of all extensions, applied to particular instance,
 * as well as resolved versions of the components that need to apply on
 * different levels. Main idea of this class: avoid re-resolving as much of the
 * stuff as possible when new extensions are added while also delaying the
 * resolve until the point it is actually needed. For example, computed fields
 * of the model won't be resolved unless the model is actually queried. Neither
 * adding extensions with `client` component only cause other components to
 * recompute.
 */
export class MergedExtensionsList {
  private constructor(private head?: MergedExtensionsListNode) {}

  static empty() {
    return new MergedExtensionsList()
  }

  static single(extension: ExtensionArgs) {
    return new MergedExtensionsList(new MergedExtensionsListNode(extension))
  }

  isEmpty(): boolean {
    return this.head === undefined
  }

  /**
   * Whether any extension in the list has a `result` component, i.e. whether
   * applying result extensions to a query result can change it at all.
   */
  hasResultExtension(): boolean {
    return this.head?.hasResultExtension() ?? false
  }

  append(extension: ExtensionArgs) {
    return new MergedExtensionsList(new MergedExtensionsListNode(extension, this.head))
  }

  getAllComputedFields(dmmfModelName: string): ComputedFieldsMap | undefined {
    return this.head?.getAllComputedFields(dmmfModelName)
  }

  getAllClientExtensions() {
    return this.head?.getAllClientExtensions()
  }

  getAllModelExtensions(dmmfModelName: string) {
    return this.head?.getAllModelExtensions(dmmfModelName)
  }

  getAllQueryCallbacks(jsModelName: string, operation: string) {
    return this.head?.getAllQueryCallbacks(jsModelName, operation) ?? []
  }

  getAllBatchQueryCallbacks() {
    return this.head?.getAllBatchQueryCallbacks() ?? []
  }
}
