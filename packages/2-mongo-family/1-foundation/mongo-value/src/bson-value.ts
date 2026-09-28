/**
 * A BSON scalar as the driver reads it. Structural, because values come from the driver's own copy of `bson`, not the classes this package could import.
 */
export type BsonScalar =
  | string
  | number
  | boolean
  | null
  | Date
  | RegExp
  | { readonly _bsontype: 'ObjectId'; toHexString(): string }
  | { readonly _bsontype: 'Long'; toBigInt(): bigint }
  | { readonly _bsontype: 'Decimal128'; toString(): string }
  | { readonly _bsontype: 'Binary'; value(): Uint8Array; readonly sub_type: number }
  | { readonly _bsontype: 'BSONRegExp'; readonly pattern: string; readonly options: string }
  | { readonly _bsontype: 'Timestamp'; toBigInt(): bigint }
  | { readonly _bsontype: 'Int32'; valueOf(): number }
  | { readonly _bsontype: 'Double'; valueOf(): number }
  | {
      readonly _bsontype: 'Code';
      readonly code: string;
      readonly scope?: { readonly [key: string]: BsonValue } | null;
    }
  | { readonly _bsontype: 'MinKey' }
  | { readonly _bsontype: 'MaxKey' }
  | { readonly _bsontype: 'BSONSymbol'; valueOf(): string };

/**
 * Any BSON value: a scalar, an array of values, or a document of values.
 */
export type BsonValue =
  | BsonScalar
  | ReadonlyArray<BsonValue>
  | { readonly [key: string]: BsonValue };

/**
 * What a `Bson` field accepts on write: any `BsonValue`, and also a `Uint8Array` or `Buffer` at any depth, which the driver writes as binData subtype 0 and reads back as `Binary`.
 */
export type BsonInputValue =
  | BsonScalar
  | Uint8Array
  | ReadonlyArray<BsonInputValue>
  | { readonly [key: string]: BsonInputValue };
