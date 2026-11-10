const STORED_JSON_TYPE_NAMES = {
  string: 'a string',
  number: 'a finite number',
  boolean: 'a boolean',
  object: 'a JSON object',
  array: 'a JSON array',
} as const;

type StoredJsonType = keyof typeof STORED_JSON_TYPE_NAMES;

/**
 * A collection validator lists an enum's members in their stored forms, so an enum's BSON type must be one whose values JSON holds. Maps each such type to the JSON type of a member's stored form.
 */
const VALIDATOR_LISTABLE_BSON_TYPES: Readonly<Record<string, StoredJsonType>> = {
  string: 'string',
  int: 'number',
  double: 'number',
  bool: 'boolean',
  object: 'object',
  array: 'array',
};

function storedJsonTypeOf(stored: unknown): string {
  if (stored === null) return 'null';
  if (Array.isArray(stored)) return 'array';
  if (typeof stored === 'number' && !Number.isFinite(stored)) return 'non-finite number';
  return typeof stored;
}

function storedText(stored: unknown): string {
  return typeof stored === 'number' || typeof stored === 'bigint'
    ? String(stored)
    : JSON.stringify(stored);
}

/**
 * Why a collection validator cannot list the members of an enum whose codec stores `bsonTypes`, or undefined when it can. Like {@link validatorEnumMemberRefusalOf}, the reason leaves out its subject so each authoring surface can lead with its own, as in `enum "Role" @@type codec "mongo/int64@1" stores BSON type long, ...`.
 */
export function validatorEnumRefusalOf(bsonTypes: readonly string[]): string | undefined {
  const [bsonType, ...otherBsonTypes] = bsonTypes;
  if (bsonType === undefined || otherBsonTypes.length > 0) {
    return `declares ${bsonTypes.length} BSON types; an enum needs exactly one. Use a codec with one BSON type, such as mongo/string@1.`;
  }
  if (VALIDATOR_LISTABLE_BSON_TYPES[bsonType] === undefined) {
    return `stores BSON type ${bsonType}, which a collection validator cannot list as an enum value. Use a codec whose BSON type is string, int, double, bool, object or array.`;
  }
  return undefined;
}

/**
 * Why a collection validator cannot list an enum member stored as `stored`, for an enum whose codec stores `bsonTypes`, or undefined when it can. The reason leaves out its subject, as in `enum "Role" member "Admin" is stored as ...`.
 */
export function validatorEnumMemberRefusalOf(
  bsonTypes: readonly string[],
  stored: unknown,
): string | undefined {
  const enumRefusal = validatorEnumRefusalOf(bsonTypes);
  if (enumRefusal !== undefined) return enumRefusal;
  const [bsonType] = bsonTypes;
  const storedJsonType =
    bsonType === undefined ? undefined : VALIDATOR_LISTABLE_BSON_TYPES[bsonType];
  if (storedJsonType === undefined || storedJsonTypeOf(stored) === storedJsonType) return undefined;
  return `is stored as ${storedText(stored)}, which a collection validator cannot list as a ${bsonType}. A member of a ${bsonType} enum must be ${STORED_JSON_TYPE_NAMES[storedJsonType]}.`;
}
