import type { JsonValue } from '@internal/contract/types';
import { structuredError } from '@internal/utils/structured-error';

function refuse(codecId: string, expected: string, json: JsonValue): never {
  throw structuredError('RUNTIME.DECODE_FAILED', `${codecId} JSON value must be ${expected}`, {
    meta: { codecId, received: typeof json },
  });
}

/** A `decodeJson` for a codec whose application value is a string: reads a JSON string and refuses any other kind. */
export function decodeJsonString(codecId: string, json: JsonValue): string {
  if (typeof json !== 'string') return refuse(codecId, 'a string', json);
  return json;
}

/** A `decodeJson` for a codec whose application value is a boolean: reads a JSON boolean and refuses any other kind. */
export function decodeJsonBoolean(codecId: string, json: JsonValue): boolean {
  if (typeof json !== 'boolean') return refuse(codecId, 'a boolean', json);
  return json;
}
