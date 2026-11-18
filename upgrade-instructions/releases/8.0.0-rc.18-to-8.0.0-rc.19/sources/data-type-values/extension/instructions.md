---
changes:
  - id: codecs-read-wire-and-data-type-values
    summary: |
      A codec implements `toWire`, `fromWire`, `toDataTypeValue` and `fromDataTypeValue` instead of
      `encode`, `decode`, `encodeJson` and `decodeJson`. Its constructor names its data type and
      parameters (`super(descriptor, dataType, params)`), and it builds the value it hands over with
      `this.dataTypeValueOf(json)`. A Mongo codec made with `mongoCodec()` takes the same four
      options in place of `encode`, `decode`, `encodeJson` and `decodeJson`, and a required
      `dataType`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:encodeJson|decodeJson)\s*\('
        - '\basync\s+(?:encode|decode)\s*\('
        - '\b(?:encode|decode)\s*:\s*(?:async\s*)?\('
        - '\b(?:encodeJson|decodeJson)\s*:'
  - id: data-types-own-parameter-limits
    summary: |
      Every data type declares a `read` function, which reads and checks each stored value under
      the column's parameters. It replaces the `toCanonicalForm` hook of a data type or codec
      descriptor, and limits a parameter sets, such as a vector's length or a geometry's SRID, move
      from the codec to the data type.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\btoCanonicalForm\b'
        - '\bsqlDataType\('
  - id: json-helpers-renamed
    summary: |
      The JSON helpers in `@prisma/orm-framework/components/codec` are renamed from `decodeJson*`
      to `readJson*` (`readJsonString`, `readJsonMatching`, `readJsonInteger`,
      `readJsonIntegerText`, `readJsonFloat`, `readJsonBoolean`), and `encodeJsonFloat` to
      `floatToJson`. `ToCanonicalForm` and `canonicalFormOf` are removed.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:decodeJson(?:String|Matching|Integer|IntegerText|Float|Boolean)|encodeJsonFloat|canonicalFormOf|ToCanonicalForm)\b'
  - id: stored-form-helpers-renamed
    summary: |
      The SQL helpers that read or write a value's stored text say "stored" instead of
      "canonical": `canonicalDateTime` is `dateTimeStoredText`, `CanonicalDateTimeOptions` is
      `DateTimeStoredTextOptions`, `canonicalNumeralText` is `storedNumeralText`,
      `sqlTextFromCanonical` is `sqlTextFromStored`, and `canonicalSqlText` is `storedSqlText`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:canonicalDateTime|CanonicalDateTimeOptions|canonicalNumeralText|sqlTextFromCanonical|canonicalSqlText)\b'
  - id: projections-read-by-from-wire
    summary: |
      An include and an aggregate read a column's JSON projection with the codec's `fromWire`, as a
      row is read, so a descriptor's `jsonProjection` writes the value the driver returns for a row,
      often `CAST(x AS text)`, instead of the codec's JSON form.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bjsonProjection\s*\('
  - id: empty-result-json-renamed-empty-result-wire
    summary: |
      An aggregate descriptor's `emptyResultJson` is renamed `emptyResultWire`, and holds the value
      the driver would return, which the result codec reads with `fromWire`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bemptyResultJson\b'
---

## `codecs-read-wire-and-data-type-values`

A codec converts between three forms of a value: the application's value, the value the database driver sends and returns (the wire value), and the value a contract stores, now a `DataTypeValue` of the codec's data type. Four methods replace the old four:

| Before | After | Converts |
| --- | --- | --- |
| `encode(value, ctx)` | `toWire(value, ctx)` | application value to wire value |
| `decode(wire, ctx)` | `fromWire(wire, ctx)` | wire value to application value |
| `encodeJson(value)` | `toDataTypeValue(value)` | application value to stored value |
| `decodeJson(json)` | `fromDataTypeValue(value)` | stored value to application value |

`toDataTypeValue` returns a `DataTypeValue`, and `fromDataTypeValue` receives one; its `value` is the JSON the contract stores. The data type has already read that JSON with its `read` function under the column's parameters, so `fromDataTypeValue` does not check it again. A codec builds the value it hands over with `this.dataTypeValueOf(json)`, which calls the data type's `valueFrom` and so refuses JSON the type does not hold. To make that possible, the codec's constructor passes its data type and its parameters to `CodecImpl`:

```ts
// before
export class PgVectorCodec extends CodecImpl</* … */> {
  constructor(descriptor: AnyCodecDescriptor, length: number) {
    super(descriptor);
    this.length = length;
  }

  async encode(value: number[], _ctx: CodecCallContext): Promise<string> {
    this.assertVector(value, 'RUNTIME.ENCODE_FAILED');
    return `[${value.join(',')}]`;
  }

  async decode(wire: string, _ctx: CodecCallContext): Promise<number[]> {
    return parseVector(wire);
  }

  encodeJson(value: number[]): JsonValue {
    this.assertVector(value, 'RUNTIME.ENCODE_FAILED');
    return [...value];
  }

  decodeJson(json: JsonValue): number[] {
    if (!Array.isArray(json) || json.length !== this.length) return this.refuseJson(json);
    return json.map(Number);
  }
}

// after
import type { DataTypeValue } from '@prisma/orm-framework/components/codec';
import { pgvectorVector } from './data-types';

export class PgVectorCodec extends CodecImpl</* … */> {
  constructor(descriptor: AnyCodecDescriptor, length: number) {
    super(descriptor, pgvectorVector, { length });
    this.length = length;
  }

  async toWire(value: number[], _ctx: CodecCallContext): Promise<string> {
    this.assertVector(value, 'RUNTIME.ENCODE_FAILED');
    return `[${value.join(',')}]`;
  }

  async fromWire(wire: string, _ctx: CodecCallContext): Promise<number[]> {
    return parseVector(wire);
  }

  fromDataTypeValue(value: DataTypeValue<readonly number[]>): number[] {
    return [...value.value];
  }

  toDataTypeValue(input: number[]): DataTypeValue {
    this.assertVector(input, 'RUNTIME.ENCODE_FAILED');
    return this.dataTypeValueOf([...input]);
  }
}
```

A codec without parameters passes only its data type: `super(descriptor, pgJsonb)`. A descriptor whose codec takes parameters passes them from `factory`:

```ts
// before
override factory(_params: GeometryParams) {
  return () => new PostgisGeometryCodec(this);
}

// after
override factory(params: GeometryParams) {
  return () => new PostgisGeometryCodec(this, params ?? {});
}
```

`DataTypeValue`, `DataTypeReader` and `refuseJsonValue` are exported from `@prisma/orm-framework/components/codec`, beside `CodecImpl`.

A Mongo codec made with `mongoCodec()` from `@prisma/orm-family-mongo/codec` takes the four options under the new names, and names its data type in a required `dataType` option, with the column's parameters in an optional `params`. Its `toDataTypeValue` returns a `DataTypeValue` too, which it builds with `dataType.valueFrom(json, params)`. It may be left out when the application value is JSON, and `fromDataTypeValue` may be left out only when the application type is exactly `JsonValue`. Declare the data type with `mongoDataType` from `@prisma/orm-family-mongo/contract/data-type`, and register it in the pack's `dataTypes` beside the codec:

```ts
// before
import { Long } from 'bson';
import { mongoCodec } from '@prisma/orm-family-mongo/codec';
import { decodeJsonString } from '@prisma/orm-framework/components/codec';
import type { JsonValue } from '@prisma/orm-framework/contract/types';

export const moneyCodec = mongoCodec({
  typeId: 'acme/money@1',
  encode: (value: bigint) => Long.fromBigInt(value),
  decode: (wire: Long) => wire.toBigInt(),
  encodeJson: (value: bigint) => value.toString(),
  decodeJson: (json: JsonValue) => BigInt(decodeJsonString('acme/money@1', json)),
});

// after
import { Long } from 'bson';
import { mongoCodec } from '@prisma/orm-family-mongo/codec';
import { mongoDataType } from '@prisma/orm-family-mongo/contract/data-type';
import { type DataTypeValue, readJsonMatching } from '@prisma/orm-framework/components/codec';

export const acmeMoney = mongoDataType('acme/money', {
  bsonTypes: ['long'],
  read: (json) => readJsonMatching('acme/money', json, /^-?\d+$/, 'decimal integer text'),
});

export const moneyCodec = mongoCodec({
  typeId: 'acme/money@1',
  dataType: acmeMoney,
  toWire: (value: bigint) => Long.fromBigInt(value),
  fromWire: (wire: Long) => wire.toBigInt(),
  toDataTypeValue: (value: bigint) => acmeMoney.valueFrom(value.toString(), {}),
  fromDataTypeValue: (value: DataTypeValue<string>) => BigInt(value.value),
});
```

## `data-types-own-parameter-limits`

A data type now reads every value a contract stores, with a `read` function that receives the JSON and the column's parameters. It returns the JSON when the type holds it and refuses it with `refuseJsonValue` when it does not. `read` is required: a data type that declared none before declares one now. It replaces `toCanonicalForm`, on the data type or on a codec descriptor, and the checks a codec made in `decodeJson` against its parameters move into it:

```ts
// before
export const pgvectorVector = sqlDataType('pgvector/vector', {
  params: pgvectorVectorParams,
  texts: [{ text: 'vector({length})', written: true, catalog: true }],
  toCanonicalForm: vectorCanonicalForm,
});

// after
const readVector: DataTypeReader = (json, params) => {
  const length = typeof params['length'] === 'number' ? params['length'] : undefined;
  const expected =
    length === undefined ? 'an array of finite numbers' : `an array of ${length} finite numbers`;
  if (!Array.isArray(json) || (length !== undefined && json.length !== length)) {
    return refuseJsonValue('pgvector/vector', expected, json);
  }
  if (!json.every(isFiniteNumber)) return refuseJsonValue('pgvector/vector', expected, json);
  return json;
};

export const pgvectorVector = sqlDataType('pgvector/vector', {
  params: pgvectorVectorParams,
  read: readVector,
  texts: [{ text: 'vector({length})', written: true, catalog: true }],
});
```

A data type that had neither `toCanonicalForm` nor parameter checks gets a `read` that accepts the JSON it stores, as PostGIS's geometry now reads HEXEWKB text:

```ts
// before
export const postgisGeometry = sqlDataType('postgis/geometry', { params, texts });

// after
const readGeometry: DataTypeReader = (json, params) => {
  const hex = readJsonMatching('postgis/geometry', json, HEX_TEXT, 'a HEXEWKB string');
  const srid = params['srid'];
  if (typeof srid !== 'number' || sridOf(hex) === srid) return json;
  return refuseJsonValue('postgis/geometry', `a HEXEWKB string of a geometry with SRID ${srid}`, json);
};

export const postgisGeometry = sqlDataType('postgis/geometry', { params, texts, read: readGeometry });
```

A parameter that limits values, such as a geometry column's SRID, is checked the same way, in the data type's `read`. A contract that stores a value the type refuses no longer loads, so a stored default that broke the limit is reported when the contract is read, not when a query runs.

## `json-helpers-renamed`

The helpers that read a value from JSON now say so, and the one that writes a float says what it returns. Rename each call:

| Before | After |
| --- | --- |
| `decodeJsonString` | `readJsonString` |
| `decodeJsonMatching` | `readJsonMatching` |
| `decodeJsonInteger` | `readJsonInteger` |
| `decodeJsonIntegerText` | `readJsonIntegerText` |
| `decodeJsonFloat` | `readJsonFloat` |
| `decodeJsonBoolean` | `readJsonBoolean` |
| `encodeJsonFloat` | `floatToJson` |

They take the same arguments. `ToCanonicalForm` and `canonicalFormOf` are removed; a data type's `read` (`data-types-own-parameter-limits`) does their work.

## `stored-form-helpers-renamed`

The text a contract stores for a value is its stored form, and the helpers that read or write it now say so. They are exported from `@prisma/orm-family-sql/contract/data-type-support` and `@prisma/orm-family-sql/contract/sql-expression` as before. Rename each use:

| Before | After |
| --- | --- |
| `canonicalDateTime` | `dateTimeStoredText` |
| `CanonicalDateTimeOptions` | `DateTimeStoredTextOptions` |
| `canonicalNumeralText` | `storedNumeralText` |
| `sqlTextFromCanonical` | `sqlTextFromStored` |
| `canonicalSqlText` | `storedSqlText` |

They take the same arguments and return the same values.

## `projections-read-by-from-wire`

An include and an aggregate now read each column of their JSON result with the codec's `fromWire`, as a plain read does. A descriptor's `jsonProjection` therefore writes the value the driver returns for an ordinary row, not the codec's stored JSON form. For a type the database prints as text, that is usually the text:

```ts
// before
protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
  return FunctionCallExpr.of('array_to_json', [
    CastExpr.as(CastExpr.as(expression, 'real[]'), 'float8[]'),
  ]);
}

// after
protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
  return CastExpr.as(expression, 'text');
}
```

A projection that returned the column unchanged may need the cast too: a JSON constructor given a `jsonb` document that is a string, or a PostGIS geometry, writes something other than the text a row carries.

## `empty-result-json-renamed-empty-result-wire`

An aggregate descriptor that declares a value for an empty input names it `emptyResultWire` instead of `emptyResultJson`. It holds the value the driver would return for that result, and the result codec reads it with `fromWire`. Only the name changes where the value was already what the driver returns:

```ts
// before
{ ...sumIntegers, nullable: false as const, emptyResultJson: '0' }

// after
{ ...sumIntegers, nullable: false as const, emptyResultWire: '0' }
```
