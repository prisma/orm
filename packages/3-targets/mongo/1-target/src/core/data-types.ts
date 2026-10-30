/**
 * The data types this target owns, one per BSON type its codecs represent, each with the BSON types
 * a value of it is stored as, the reader of its stored form, and the casts that say which other
 * types' values it takes and how. A cast is declared by the type that receives. ADR 254.
 */

import type {
  Cast,
  DataType,
  DataTypeId,
  DataTypeReader,
  DataTypeSpelling,
} from '@internal/framework-components/codec';
import {
  asFloat,
  asNumeralText,
  castUnchanged,
  dateTimeStoredText,
  decimalTextEqualityKey,
  isoDateStringText,
  readJsonBoolean,
  readJsonFloat,
  readJsonString,
  refuseJsonValue,
  refuseWrongShape,
} from '@internal/framework-components/codec';
import { mongoDataType } from '@internal/mongo-contract/data-type';
import {
  withoutZerosBelowAMillisecond,
  withThreeFractionDigits,
} from '@internal/type-implementations/date';
import { ISO_DURATION_AS_WRITTEN } from '@internal/type-implementations/duration';
import { ifDefined } from '@internal/utils/defined';
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

/** The calendar dates a JavaScript `Date`, and so a BSON date, holds at midnight UTC. */
const DATE_RANGE = { earliest: '-271821-04-20', latest: '+275760-09-13' } as const;

/** An instant as `mongo/date` stores it, in UTC with three fraction digits, from ISO 8601 text with a UTC offset in which zeros past the third fraction digit are dropped. Throws `CONTRACT.CAST_REFUSED` for text that names no instant a `Date` holds. */
export function mongoInstantText(text: string): string {
  return isoDateStringText(withoutZerosBelowAMillisecond(text), 'mongo/date');
}

/** A calendar date as ISO 8601 text, `2024-02-29`, in the years a BSON date holds at midnight UTC. Throws `CONTRACT.CAST_REFUSED` for text that names no such date. */
export function mongoCalendarDateText(text: string): string {
  return dateTimeStoredText(text, { shape: 'date', ownerId: 'mongo/date', range: DATE_RANGE });
}

/** The value of `mongo/time`: a time of day with exactly three fraction digits, `09:30:00.000`, so the strings sort in the order of the times. Zeros past the third fraction digit are dropped; any other digit there is refused. Throws `CONTRACT.CAST_REFUSED` for text that names no such time. */
export function mongoTimeText(text: string): string {
  return withThreeFractionDigits(
    dateTimeStoredText(
      withoutZerosBelowAMillisecond(text),
      { shape: 'time', ownerId: 'mongo/time', maxFractionDigits: 3 },
      text,
    ),
  );
}

/** The value of `mongo/duration`: an ISO 8601 duration, stored as written. Throws `CONTRACT.CAST_REFUSED` for other text. */
export function mongoDurationText(text: string): string {
  if (ISO_DURATION_AS_WRITTEN.test(text)) return text;
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `mongo/duration cannot read "${text}". Write an ISO 8601 duration, as in "PT1H30M".`,
    {
      why: 'mongo/duration holds an ISO 8601 duration as Temporal.Duration writes it: an optional sign, P, then years, months, weeks and days, then T and hours, minutes and seconds. A sign on each component instead is read too.',
      fix: 'Write the duration in ISO 8601, as in "P1Y2M3DT4H5M6.5S".',
    },
  );
}

export const mongoString = mongoDataType('mongo/string', {
  read: (json) => readJsonString('mongo/string', json),
  bsonTypes: ['string'],
});

/** What `stored` writes for `text`, or `undefined` when it refuses it. */
function storedOrUndefined(stored: (text: string) => string, text: string): string | undefined {
  try {
    return stored(text);
  } catch {
    return undefined;
  }
}

/** A BSON string type in one form for each value when `respell`: it reads any text `stored` takes, and spells it in the form `stored` writes. It takes a `mongo/string` value that `stored` reads. */
function storedStringDataType(
  id: string,
  stored: (text: string) => string,
  expected: string,
  options: { readonly respell: boolean },
) {
  const fromString: Cast = (value) =>
    typeof value === 'string' ? stored(value) : refuseWrongShape(value, 'text');
  const read: DataTypeReader = (json) =>
    typeof json === 'string' && storedOrUndefined(stored, json) !== undefined
      ? json
      : refuseJsonValue(id, expected, json);
  const spell: DataTypeSpelling = (json) =>
    typeof json === 'string' ? (storedOrUndefined(stored, json) ?? json) : json;
  return mongoDataType(id, {
    read,
    ...ifDefined('spell', options.respell ? spell : undefined),
    bsonTypes: ['string'],
    casts: { [mongoString.id]: fromString },
  });
}
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
/** A time of day, stored as a BSON string with three fraction digits, `09:30:00.000`. */
export const mongoTime = storedStringDataType(
  'mongo/time',
  mongoTimeText,
  'ISO 8601 time of day text with at most three fraction digits, as in "09:30:00"',
  { respell: true },
);

/** A length of time, stored as the ISO 8601 duration it was written as, `PT1H30M`. Equal durations can be written differently, `P1D` and `PT24H`, so a duration keeps its spelling. */
export const mongoDuration = storedStringDataType(
  'mongo/duration',
  mongoDurationText,
  'an ISO 8601 duration, as in "PT1H30M"',
  { respell: false },
);

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
  mongoTime,
  mongoDuration,
  mongoVector,
  mongoInt64,
  mongoDecimal128,
  mongoBinary,
  mongoJson,
  mongoBson,
];

/** MongoDB's text data type: `string`. */
export const mongoTextDataTypes: readonly DataTypeId[] = [mongoString.id];
