/**
 * Schema-aware traversal algorithm for parameterization.
 *
 * This module implements the core parameterization logic that walks the
 * JsonQuery tree guided by ParamGraph. It only parameterizes values when
 * both schema rules and runtime value types agree.
 */

import type {
  JsonArgumentValue,
  JsonBatchQuery,
  JsonFieldSelection,
  JsonInputTaggedValue,
  JsonQuery,
  JsonSelectionSet,
  PlaceholderTaggedValue,
} from '@prisma/json-protocol'
import { PlaceholderType } from '@prisma/json-protocol'
import type { InputEdge, InputNode } from '@prisma/param-graph'
import { EdgeFlag, getScalarMask, hasFlag, ParamGraph, ScalarMask } from '@prisma/param-graph'

import { deserializeJsonObject } from '../json-protocol'
import { safeJsonStringify } from '../utils'
import { classifyValue, isPlainObject, isTaggedValue, ValueClass } from './classify'

/**
 * Result of parameterizing a single query.
 */
export interface ParameterizeResult {
  /** The query with user data values replaced by placeholders */
  parameterizedQuery: JsonQuery
  /** Map of placeholder names to their actual values */
  placeholderValues: Record<string, unknown>
}

/**
 * Result of parameterizing a batch of queries.
 */
export interface ParameterizeBatchResult {
  /** The batch with user data values replaced by placeholders */
  parameterizedBatch: JsonBatchQuery
  /** Combined map of placeholder names to their actual values */
  placeholderValues: Record<string, unknown>
}

/**
 * Parameterizes a single query using the schema-aware approach.
 *
 * @param query - The query to parameterize
 * @param view - The ParamGraph for schema lookups
 * @returns The parameterized query with extracted placeholder values
 */
export function parameterizeQuery(query: JsonQuery, view: ParamGraph): ParameterizeResult {
  const parameterizer = new Parameterizer(view)

  const rootKey = query.modelName ? `${query.modelName}.${query.action}` : query.action
  const root = view.root(rootKey)

  const parameterizedQuery: JsonQuery = {
    ...query,
    query: parameterizer.parameterizeFieldSelection(query.query, root?.argsNodeId, root?.outputNodeId),
  }

  return {
    parameterizedQuery,
    placeholderValues: parameterizer.getPlaceholderValues(),
  }
}

/**
 * Parameterizes a batch of queries using the schema-aware approach.
 *
 * @param batch - The batch to parameterize
 * @param view - The ParamGraph for schema lookups
 * @returns The parameterized batch with extracted placeholder values
 */
export function parameterizeBatch(batch: JsonBatchQuery, view: ParamGraph): ParameterizeBatchResult {
  const parameterizer = new Parameterizer(view)
  const parameterizedQueries: JsonQuery[] = []

  for (let i = 0; i < batch.batch.length; i++) {
    const query = batch.batch[i]

    const rootKey = query.modelName ? `${query.modelName}.${query.action}` : query.action
    const root = view.root(rootKey)

    parameterizedQueries.push({
      ...query,
      query: parameterizer.parameterizeFieldSelection(query.query, root?.argsNodeId, root?.outputNodeId),
    })
  }

  return {
    parameterizedBatch: { ...batch, batch: parameterizedQueries },
    placeholderValues: parameterizer.getPlaceholderValues(),
  }
}

/**
 * Encapsulates the state and logic for parameterizing queries.
 */
class Parameterizer {
  readonly #view: ParamGraph
  readonly #placeholders = new Map<string, unknown>()
  readonly #valueToPlaceholder = new Map<string, string>()
  #nextPlaceholderId = 1

  constructor(view: ParamGraph) {
    this.#view = view
  }

  /**
   * Returns the collected placeholder values as a plain object.
   */
  getPlaceholderValues(): Record<string, unknown> {
    return Object.fromEntries(this.#placeholders)
  }

  /**
   * Gets or creates a placeholder for the given value.
   * If a placeholder already exists for this value, returns a reference to the existing name.
   * Otherwise, registers a new placeholder with a sequential name.
   * We reuse the placeholders for equal values because the query compiler needs to be able
   * to compare the values for equality for certain optimizations (at the time of writing,
   * only for deciding whether to use native or emulated upserts).
   */
  #getOrCreatePlaceholder(value: unknown, type: PlaceholderType): PlaceholderTaggedValue {
    const valueKey = createValueKey(value, type)
    const existingName = this.#valueToPlaceholder.get(valueKey)

    if (existingName !== undefined) {
      return createPlaceholder(existingName, type)
    }

    const name = `%${this.#nextPlaceholderId++}`
    this.#valueToPlaceholder.set(valueKey, name)
    this.#placeholders.set(name, value)
    return createPlaceholder(name, type)
  }

  /**
   * Parameterizes a field selection (arguments + selection).
   */
  parameterizeFieldSelection(
    sel: JsonFieldSelection,
    argsNodeId: number | undefined,
    outNodeId: number | undefined,
  ): JsonFieldSelection {
    const argsNode = this.#view.inputNode(argsNodeId)
    const outNode = this.#view.outputNode(outNodeId)

    const result: JsonFieldSelection = { ...sel }

    if (sel.arguments && sel.arguments.$type !== 'Raw') {
      result.arguments = this.#parameterizeObject(sel.arguments as Record<string, unknown>, argsNode)
    }

    if (sel.selection) {
      result.selection = this.#parameterizeSelection(sel.selection, outNode)
    }

    return result
  }

  /**
   * Parameterizes an object by traversing its fields with the input node.
   */
  #parameterizeObject(obj: Record<string, unknown>, node: InputNode | undefined): Record<string, JsonArgumentValue> {
    if (!node) {
      // No parameterizable fields in this subtree - return as-is
      return obj as Record<string, JsonArgumentValue>
    }

    const result: Record<string, JsonArgumentValue> = {}

    for (const [key, value] of Object.entries(obj)) {
      const edge = this.#view.inputEdge(node, key)

      if (edge) {
        result[key] = this.#parameterizeValue(value, edge, key) as JsonArgumentValue
      } else {
        result[key] = value as JsonArgumentValue
      }
    }

    return result
  }

  /**
   * Core parameterization logic for a single value.
   */
  #parameterizeValue(value: unknown, edge: InputEdge, key: string): unknown {
    const classified = classifyValue(value)

    switch (classified.kind) {
      case 'null':
        // Null values are never parameterized - they affect query semantics
        return value

      case 'structural':
        return value

      case 'primitive':
        return this.#handlePrimitive(classified.value, edge, key)

      case 'taggedScalar':
        return this.#handleTaggedScalar(value as JsonInputTaggedValue, classified.tag, edge)

      case 'array':
        return this.#handleArray(classified.items, value, edge)

      case 'object':
        return this.#handleObject(classified.entries, edge)

      default:
        throw new Error(`Unknown value kind ${(classified satisfies never as ValueClass).kind}`)
    }
  }

  /**
   * Handles parameterization of primitive values (string, number, boolean).
   */
  #handlePrimitive(value: string | number | boolean, edge: InputEdge, key: string): JsonArgumentValue {
    if (hasFlag(edge, EdgeFlag.ParamEnum) && edge.enumNameIndex !== undefined && typeof value === 'string') {
      const enumValues = this.#view.enumValues(edge)
      if (enumValues && Object.hasOwn(enumValues, value)) {
        const type: PlaceholderType = { type: 'Enum' }
        return this.#getOrCreatePlaceholder(enumValues[value], type)
      }
    }

    if (!hasFlag(edge, EdgeFlag.ParamScalar)) {
      return value
    }

    const mask = getScalarMask(edge)
    if (mask === 0) {
      return value
    }

    if (mask & ScalarMask.Json) {
      if (JSON_COMPARISON_FILTERS.has(key)) {
        return value
      }

      const jsonValue = JSON.stringify(value)
      const type: PlaceholderType = { type: 'Json' }
      return this.#getOrCreatePlaceholder(jsonValue, type)
    }

    const type = getPrimitivePlaceholderType(value)
    if (!matchesPrimitiveMask(type, mask)) {
      return value
    }

    return this.#getOrCreatePlaceholder(value, type)
  }

  /**
   * Handles parameterization of tagged scalar values (DateTime, Decimal, etc.).
   */
  #handleTaggedScalar(tagged: JsonInputTaggedValue, tag: JsonInputTaggedValue['$type'], edge: InputEdge): unknown {
    if (!hasFlag(edge, EdgeFlag.ParamScalar)) {
      return tagged
    }

    const mask = getScalarMask(edge)
    if (mask === 0 || !matchesTaggedMask(tag, mask)) {
      return tagged
    }

    const type = getTaggedPlaceholderType(tagged.$type)!
    const decoded = decodeTaggedValue(tagged)

    return this.#getOrCreatePlaceholder(decoded, type)
  }

  /**
   * Handles parameterization of array values.
   */
  #handleArray(items: unknown[], originalValue: unknown, edge: InputEdge): unknown {
    if (hasFlag(edge, EdgeFlag.ParamScalar) && getScalarMask(edge) & ScalarMask.Json) {
      const jsonValue = safeJsonStringify(deserializeJsonObject(items))
      const type: PlaceholderType = { type: 'Json' }
      return this.#getOrCreatePlaceholder(jsonValue, type)
    }

    if (hasFlag(edge, EdgeFlag.ParamEnum)) {
      const enumValues = this.#view.enumValues(edge)
      if (enumValues && items.every((item) => typeof item === 'string' && Object.hasOwn(enumValues, item))) {
        const type: PlaceholderType = { type: 'List', inner: { type: 'Enum' } }
        return this.#getOrCreatePlaceholder(items, type)
      }
    }

    if (hasFlag(edge, EdgeFlag.ParamListScalar)) {
      const allValid = items.every((item) => validateListElement(item, edge))
      if (allValid && items.length > 0) {
        const decodedItems = items.map((item) => decodeIfTagged(item))
        const innerType = inferListElementType(items)
        const type: PlaceholderType = { type: 'List', inner: innerType }
        return this.#getOrCreatePlaceholder(decodedItems, type)
      }
    }

    if (hasFlag(edge, EdgeFlag.ListObject)) {
      const childNode = this.#view.inputNode(edge.childNodeId)
      if (childNode) {
        return items.map((item) => {
          if (isPlainObject(item)) {
            return this.#parameterizeObject(item, childNode)
          }
          return item
        })
      }
    }

    return originalValue
  }

  /**
   * Handles parameterization of object values.
   */
  #handleObject(obj: Record<string, unknown>, edge: InputEdge): unknown {
    if (hasFlag(edge, EdgeFlag.Object)) {
      const childNode = this.#view.inputNode(edge.childNodeId)
      if (childNode) {
        return this.#parameterizeObject(obj, childNode)
      }
    }

    const mask = getScalarMask(edge)
    if (mask & ScalarMask.Json) {
      const jsonValue = safeJsonStringify(deserializeJsonObject(obj))
      const type: PlaceholderType = { type: 'Json' }
      return this.#getOrCreatePlaceholder(jsonValue, type)
    }

    return obj
  }

  /**
   * Parameterizes a selection set using output nodes.
   */
  #parameterizeSelection(selection: JsonSelectionSet, node: ReturnType<ParamGraph['outputNode']>): JsonSelectionSet {
    if (!selection || !node) {
      return selection
    }

    const result: JsonSelectionSet = {}

    for (const [key, value] of Object.entries(selection)) {
      if (key === '$scalars' || key === '$composites' || typeof value === 'boolean') {
        result[key] = value
        continue
      }

      const edge = this.#view.outputEdge(node, key)

      if (edge) {
        // Nested selection with possible args
        const nested = value as { arguments?: Record<string, unknown>; selection?: JsonSelectionSet }

        const argsNode = this.#view.inputNode(edge.argsNodeId)
        const childOutNode = this.#view.outputNode(edge.outputNodeId)

        const processedValue: JsonFieldSelection = {
          selection: nested.selection ? this.#parameterizeSelection(nested.selection, childOutNode) : {},
        }

        if (nested.arguments) {
          processedValue.arguments = this.#parameterizeObject(nested.arguments, argsNode)
        }

        result[key] = processedValue
      } else {
        result[key] = value
      }
    }

    return result
  }
}

/**
 * Creates a placeholder object with the given name.
 */
function createPlaceholder(name: string, type: PlaceholderType): PlaceholderTaggedValue {
  return { $type: 'Param', value: { name, ...type } }
}

/**
 * Serializes a PlaceholderType to a string for use as part of a value key.
 */
function serializePlaceholderType(type: PlaceholderType): string {
  if (type.type === 'List') {
    return `List<${serializePlaceholderType(type.inner)}>`
  }
  return type.type
}

/**
 * Serializes a value to a string for use as part of a value key.
 */
function serializeValue(value: unknown): string {
  if (ArrayBuffer.isView(value)) {
    const bufView = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    return bufView.toString('base64')
  }
  return JSON.stringify(value)
}

/**
 * Creates a unique key for a (value, type) pair.
 * Used to detect when the same value appears multiple times.
 */
function createValueKey(value: unknown, type: PlaceholderType): string {
  const typeKey = serializePlaceholderType(type)
  const valueKey = serializeValue(value)
  return `${typeKey}:${valueKey}`
}

// The query compiler reads the literal value of these filters to choose which JSON type to compare against
const JSON_COMPARISON_FILTERS = new Set(['gt', 'gte', 'lt', 'lte'])

const MAX_INT = 2 ** 31 - 1
const MIN_INT = -(2 ** 31)

function getPrimitivePlaceholderType(value: string | number | boolean): PlaceholderType {
  switch (typeof value) {
    case 'boolean':
      return { type: 'Boolean' }

    case 'number':
      if (!Number.isInteger(value)) {
        return { type: 'Float' }
      }
      if (MIN_INT <= value && value <= MAX_INT) {
        return { type: 'Int' }
      }
      return { type: 'BigInt' }

    case 'string':
      return { type: 'String' }

    default:
      throw new Error('unreachable')
  }
}

/**
 * Checks if a primitive value matches the scalar mask.
 */
function matchesPrimitiveMask({ type }: PlaceholderType, mask: number): boolean {
  switch (type) {
    case 'Boolean':
      return (mask & ScalarMask.Boolean) !== 0
    case 'Int':
      return (mask & (ScalarMask.Int | ScalarMask.BigInt | ScalarMask.Float)) !== 0
    case 'BigInt':
      return (mask & ScalarMask.BigInt) !== 0
    case 'Float':
      return (mask & ScalarMask.Float) !== 0
    case 'String':
      return (mask & ScalarMask.String) !== 0
    default:
      return false
  }
}

function getTaggedPlaceholderType(tag: JsonInputTaggedValue['$type']): PlaceholderType | undefined {
  switch (tag) {
    case 'BigInt':
    case 'Bytes':
    case 'DateTime':
    case 'Json':
      return { type: tag }
    case 'Decimal':
      // PrismaValueType doesn't have a Decimal variant and treats both Floats
      // and Decimal as decimals
      return { type: 'Float' }
    default:
      return undefined
  }
}

/**
 * Infers the widest placeholder type that accommodates all elements in a list.
 * For example, a list containing both Int and Float values infers Float.
 */
function inferListElementType(items: unknown[]): PlaceholderType {
  let widest: PlaceholderType = { type: 'Any' }

  for (const item of items) {
    const classified = classifyValue(item)
    let itemType: PlaceholderType

    switch (classified.kind) {
      case 'primitive':
        itemType = getPrimitivePlaceholderType(classified.value)
        break
      case 'taggedScalar':
        itemType = getTaggedPlaceholderType(classified.tag) ?? { type: 'Any' }
        break
      default:
        return { type: 'Any' }
    }

    widest = widenType(widest, itemType)
  }

  return widest
}

/**
 * Returns the wider of two placeholder types, following numeric promotion rules:
 * Int -> BigInt -> Float. Non-numeric types must match exactly or produce Any.
 */
function widenType(a: PlaceholderType, b: PlaceholderType): PlaceholderType {
  if (a.type === 'Any') return b
  if (b.type === 'Any') return a
  if (a.type === b.type) return a

  const NUMERIC_WIDTH: Partial<Record<PlaceholderType['type'], number>> = { Int: 0, BigInt: 1, Float: 2 }
  const aWidth = NUMERIC_WIDTH[a.type]
  const bWidth = NUMERIC_WIDTH[b.type]

  if (aWidth !== undefined && bWidth !== undefined) {
    return aWidth >= bWidth ? a : b
  }

  return { type: 'Any' }
}

/**
 * Checks if a tagged scalar tag matches the scalar mask.
 */
function matchesTaggedMask(tag: JsonInputTaggedValue['$type'], mask: number): boolean {
  switch (tag) {
    case 'DateTime':
      return (mask & ScalarMask.DateTime) !== 0
    case 'Decimal':
      return (mask & ScalarMask.Decimal) !== 0
    case 'BigInt':
      return (mask & ScalarMask.BigInt) !== 0
    case 'Bytes':
      return (mask & ScalarMask.Bytes) !== 0
    case 'Json':
      return (mask & ScalarMask.Json) !== 0
    default:
      return false
  }
}

/**
 * Validates that a list element can be parameterized.
 */
function validateListElement(item: unknown, edge: InputEdge): boolean {
  const classified = classifyValue(item)

  switch (classified.kind) {
    case 'structural':
      return false

    case 'null':
      return false

    case 'primitive': {
      const type = getPrimitivePlaceholderType(classified.value)
      const mask = getScalarMask(edge)
      return mask !== 0 && matchesPrimitiveMask(type, mask)
    }

    case 'taggedScalar': {
      const mask = getScalarMask(edge)
      return mask !== 0 && matchesTaggedMask(classified.tag, mask)
    }

    default:
      return false
  }
}

/**
 * Decodes a value if it's a tagged scalar, otherwise returns as-is.
 */
function decodeIfTagged(value: unknown): unknown {
  if (isTaggedValue(value)) {
    return decodeTaggedValue(value)
  }
  return value
}

/**
 * Decodes a tagged scalar value to its raw form.
 */
function decodeTaggedValue(tagged: { $type: string; value: unknown }): unknown {
  return tagged.value
}
