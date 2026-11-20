/**
 * Value classification for parameterization.
 *
 * This module classifies runtime values into categories before applying
 * schema rules during parameterization.
 */

import { JsonInputTaggedValue } from '@prisma/json-protocol'

/**
 * Tagged value types that represent scalar values.
 * These can be parameterized when the schema allows.
 */
const SCALAR_TAGS = new Set(['DateTime', 'Decimal', 'BigInt', 'Bytes', 'Json', 'Raw'])

/**
 * Classification result for a runtime value.
 * Used to determine how to handle the value during parameterization.
 */
export type ValueClass =
  | { kind: 'null' }
  | { kind: 'primitive'; value: string | number | boolean }
  | { kind: 'taggedScalar'; tag: JsonInputTaggedValue['$type']; value: unknown }
  | { kind: 'structural'; value: unknown }
  | { kind: 'array'; items: unknown[] }
  | { kind: 'object'; entries: Record<string, unknown> }

/**
 * Classifies a runtime value for parameterization purposes.
 *
 * @param value - The value to classify
 * @returns The classification result indicating how to handle the value
 */
export function classifyValue(value: unknown): ValueClass {
  if (value === null || value === undefined) {
    return { kind: 'null' }
  }

  if (typeof value === 'string') {
    return { kind: 'primitive', value }
  }
  if (typeof value === 'number') {
    return { kind: 'primitive', value }
  }
  if (typeof value === 'boolean') {
    return { kind: 'primitive', value }
  }

  if (Array.isArray(value)) {
    return { kind: 'array', items: value }
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>

    if ('$type' in obj && typeof obj.$type === 'string') {
      const tag = obj.$type as JsonInputTaggedValue['$type']

      if (SCALAR_TAGS.has(tag)) {
        return { kind: 'taggedScalar', tag, value: obj.value }
      }

      // Known structural tags and any unknown $type tags are treated as structural
      // to avoid parameterizing tagged payloads that we don't understand.
      return { kind: 'structural', value: obj.value }
    }

    return { kind: 'object', entries: obj }
  }

  return { kind: 'structural', value }
}

/**
 * Checks if a value is a plain object (not a tagged value or array).
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !('$type' in (value as Record<string, unknown>))
  )
}

/**
 * Checks if a value is a tagged value with a $type property.
 */
export function isTaggedValue(value: unknown): value is { $type: string; value: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$type' in value &&
    typeof (value as { $type: unknown }).$type === 'string'
  )
}
