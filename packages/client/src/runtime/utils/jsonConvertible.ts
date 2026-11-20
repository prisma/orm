import { JsonConvertible } from '../core/types/exported/JsApi'

export function isJSONConvertible(value: unknown): value is JsonConvertible {
  return typeof value === 'object' && value !== null && typeof value['toJSON'] === 'function'
}
