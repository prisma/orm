export const JSON_TYPES = ['string', 'number', 'boolean', 'object', 'array', 'any'] as const;

/**
 * The JSON type a codec's value is written as inside a JSON document. `'any'` means the value can be any JSON value, including `null`, as for a JSON codec.
 */
export type JsonType = (typeof JSON_TYPES)[number];

export function isJsonType(value: unknown): value is JsonType {
  return JSON_TYPES.some((jsonType) => jsonType === value);
}

/** The JSON type a codec descriptor declares, or `undefined` when it declares none, as a descriptor compiled before codecs declared one does. */
export function declaredJsonType(descriptor: object): JsonType | undefined {
  const jsonType = Reflect.get(descriptor, 'jsonType');
  return isJsonType(jsonType) ? jsonType : undefined;
}
