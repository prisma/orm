import { Cache } from '@prisma/client-common'
import * as DMMF from '@prisma/dmmf'

import { DMMFHelper } from './dmmf'

type ToVisitItem = {
  type: DMMF.InputType
  parent?: ToVisitItem
}

export class GenericArgsInfo {
  private _cache = new Cache<DMMF.InputType, boolean>()

  constructor(private _dmmf: DMMFHelper) {}

  /**
   * Determines if arg types need generic <$PrismaModel> argument added.
   * Essentially, performs breadth-first search for any fieldRefTypes that
   * do not have corresponding `meta.source` defined.
   *
   * @param type
   * @returns
   */
  typeNeedsGenericModelArg(topLevelType: DMMF.InputType): boolean {
    return this._cache.getOrCreate(topLevelType, () => {
      const toVisit: ToVisitItem[] = [{ type: topLevelType }]
      // Every type that has ever been put in `toVisit`. A type that many fields point to is
      // queued only once, so the queue grows with the number of types, not with the number of
      // fields that reference them. This also stops the search from going round in loops.
      const queued = new Set<DMMF.InputType>([topLevelType])
      const visited = new Set<DMMF.InputType>()
      // Walk the queue by index instead of `toVisit.shift()`: shifting a large array copies it,
      // which made this search quadratic in the queue length on big schemas.
      for (let index = 0; index < toVisit.length; index++) {
        const item = toVisit[index]
        const { type: currentType } = item
        const cached = this._cache.get(currentType)
        if (cached === true) {
          this._cacheResultsForTree(item)
          return true
        }
        if (cached === false) {
          continue
        }
        if (currentType.meta?.source) {
          // if source is defined, we know model for sure and do not need generic argument
          this._cache.set(currentType, false)
          continue
        }
        visited.add(currentType)
        for (const field of currentType.fields) {
          for (const fieldType of field.inputTypes) {
            if (fieldType.location === 'fieldRefTypes') {
              this._cacheResultsForTree(item)
              return true
            }
            const inputObject = this._dmmf.resolveInputObjectType(fieldType)
            if (inputObject && !queued.has(inputObject)) {
              queued.add(inputObject)
              toVisit.push({ type: inputObject, parent: item })
            }
          }
        }
      }
      // if we reached this point then none of the types we have visited so far require generic type
      for (const visitedType of visited) {
        this._cache.set(visitedType, false)
      }
      return false
    })
  }

  typeRefNeedsGenericModelArg(ref: DMMF.InputTypeRef) {
    if (ref.location === 'fieldRefTypes') {
      return true
    }
    const inputType = this._dmmf.resolveInputObjectType(ref)
    if (!inputType) {
      return false
    }
    return this.typeNeedsGenericModelArg(inputType)
  }

  private _cacheResultsForTree(item: ToVisitItem): void {
    let currentItem: ToVisitItem | undefined = item
    while (currentItem) {
      this._cache.set(currentItem.type, true)
      currentItem = currentItem.parent
    }
  }
}
