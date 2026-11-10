/**
 * The data types this target owns, one per BSON type its codecs represent, each with the BSON types
 * a value of it is stored as, the reader of its stored form, and the casts that say which other
 * types' values it takes and how. A cast is declared by the type that receives. ADR 254.
 */

import type { Cast, DataType, DataTypeId } from '@internal/framework-components/codec';
import {
  asFloat,
  asNumeralText,
  castUnchanged,
  decimalTextEqualityKey,
  readJsonBoolean,
  readJsonFloat,
  readJsonString,
  refuseWrongShape,
} from '@internal/framework-components/codec';
import { mongoDataType } from '@internal/mongo-contract/data-type';
import { structuredError } from '@internal/utils/structured-error';
import { type as arktype } from 'arktype';
import { readBsonJson } from './bson-codec-helpers';
import {
  isObjectIdText,
  readBinaryJson,
  readDateJson,
  readDecimal128Json,
  readInt32Json,
  readInt64Json,
  readObjectIdJson,
  readVectorJson,
  spellBase64Json,
  spellDecimal128Json,
  spellObjectIdJson,
} from './bson-scalar-helpers';

/** The vector's dimension: the TypeScript type `Vector<n>` and the type's reader read it. */
export const mongoVectorParams = arktype({ 'length?': 'number.integer >= 1' });

/** Text as the ObjectId it names; {@link spellObjectIdJson} gives it the lower case the type stores. */
const asObjectId: Cast = (value) => {
  if (typeof value !== 'string') return refuseWrongShape(value, 'text');
  if (isObjectIdText(value)) return value;
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `"${value}" is not an ObjectId: write 24 hexadecimal digits.`,
    {
      why: 'An ObjectId is 12 bytes, written as 24 hexadecimal digits.',
      fix: 'Write the ObjectId as 24 hexadecimal digits, as in "507f1f77bcf86cd799439011".',
    },
  );
};

/** The numbers of a written list as a vector stores them, each finite. */
function vectorElements(elements: readonly unknown[]): number[] {
  return elements.map((element, index) => {
    const number = Number(element);
    if (Number.isFinite(number)) return number;
    throw structuredError(
      'CONTRACT.CAST_REFUSED',
      `a vector element is a finite number, and element ${index + 1} is ${String(element)}.`,
      {
        why: 'A vector holds finite numbers, as a vector search index reads them.',
        fix: 'Write each element as a finite number.',
      },
    );
  });
}

export const mongoString = mongoDataType('mongo/string', {
  read: (json) => readJsonString('mongo/string', json),
  bsonTypes: ['string'],
});
export const mongoInt32 = mongoDataType('mongo/int32', {
  read: (json) => readInt32Json('mongo/int32', json),
  bsonTypes: ['int'],
});
export const mongoInt64 = mongoDataType('mongo/int64', {
  read: (json) => readInt64Json('mongo/int64', json),
  bsonTypes: ['long'],
  casts: { [mongoInt32.id]: asNumeralText },
});
export const mongoDecimal128 = mongoDataType('mongo/decimal128', {
  read: (json) => readDecimal128Json('mongo/decimal128', json),
  spell: spellDecimal128Json,
  equalityKey: decimalTextEqualityKey,
  bsonTypes: ['decimal'],
  casts: { [mongoInt32.id]: asNumeralText, [mongoInt64.id]: castUnchanged },
});
export const mongoDouble = mongoDataType('mongo/double', {
  read: (json) => {
    readJsonFloat('mongo/double', json);
    return json;
  },
  bsonTypes: ['double'],
  casts: { [mongoInt32.id]: asFloat, [mongoInt64.id]: asFloat, [mongoDecimal128.id]: asFloat },
});
export const mongoObjectId = mongoDataType('mongo/objectid', {
  read: (json) => readObjectIdJson('mongo/objectid', json),
  spell: spellObjectIdJson,
  bsonTypes: ['objectId'],
  casts: { [mongoString.id]: asObjectId },
});
export const mongoBool = mongoDataType('mongo/bool', {
  read: (json) => readJsonBoolean('mongo/bool', json),
  bsonTypes: ['bool'],
});
export const mongoDate = mongoDataType('mongo/date', {
  read: (json) => readDateJson('mongo/date', json),
  bsonTypes: ['date'],
});
export const mongoVector = mongoDataType('mongo/vector', {
  read: (json, params) =>
    readVectorJson(
      'mongo/vector',
      json,
      typeof params['length'] === 'number' ? params['length'] : undefined,
    ),
  bsonTypes: ['array'],
  params: mongoVectorParams,
  listCast: {
    of: [mongoInt32.id, mongoInt64.id, mongoDecimal128.id, mongoDouble.id],
    cast: vectorElements,
  },
});
export const mongoBinary = mongoDataType('mongo/binary', {
  read: (json) => readBinaryJson('mongo/binary', json),
  spell: spellBase64Json,
  bsonTypes: ['binData'],
});
export const mongoJson = mongoDataType('mongo/json', {
  read: (json) => json,
  bsonTypes: ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'],
});
export const mongoBson = mongoDataType('mongo/bson', {
  read: (json) => {
    readBsonJson('mongo/bson', json);
    return json;
  },
  bsonTypes: [],
});

export const mongoDataTypes: readonly DataType[] = [
  mongoObjectId,
  mongoString,
  mongoDouble,
  mongoInt32,
  mongoBool,
  mongoDate,
  mongoVector,
  mongoInt64,
  mongoDecimal128,
  mongoBinary,
  mongoJson,
  mongoBson,
];

/** MongoDB's text data type: `string`. */
export const mongoTextDataTypes: readonly DataTypeId[] = [mongoString.id];
