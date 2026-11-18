/**
 * The six SQL base codecs (TML-2357).
 *
 * Each codec ships as three artifacts:
 *
 * 1. A `SqlXCodec` class extending {@link CodecImpl} that wraps the module-level wire conversions exported from `sql-codec-helpers.ts` (the single source of truth for runtime behaviour). 2. A `SqlXDescriptor` class extending {@link CodecDescriptorTemplateImpl} declaring the codec id, traits, target types, and params schema; the data type is left to the target that adapts the template, which builds the codec with that type. 3. A per-codec column helper (`sqlXColumn`)
 * that calls `descriptor.factory(...)` directly and packages the result into a {@link ColumnSpec} via the framework {@link column} packager. The helper is tied to its descriptor with `satisfies ColumnHelperFor`.
 *
 * After TML-2357 this file is the canonical source of SQL base codec metadata and runtime behaviour — the legacy `mkCodec` / `defineCodec` carriers retired with the deletion sweep.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  CodecDescriptorTemplateImpl,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
  type DataTypeValue,
  floatToJson,
  readJsonFloat,
  readJsonInteger,
  SAFE_INTEGER_RANGE,
} from '@internal/framework-components/codec';
import { InternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';
import {
  SQL_CHAR_CODEC_ID,
  SQL_FLOAT_CODEC_ID,
  SQL_INT_CODEC_ID,
  SQL_RAW_CODEC_ID,
  SQL_TEXT_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
  sqlCharDecode,
  sqlCharEncode,
  sqlFloatDecode,
  sqlFloatEncode,
  sqlIntDecode,
  sqlIntEncode,
  sqlTextDecode,
  sqlTextEncode,
  sqlVarcharDecode,
  sqlVarcharEncode,
} from './sql-codec-helpers';

type LengthParams = { readonly length?: number };

/** A family codec has no data type of its own, so only a target that adapts it, naming its data type, builds its codec. A column helper below names the codec for a contract; the target's adapted descriptor builds it. */
function unadapted(codecId: string): never {
  throw new InternalError(
    `${codecId} is a SQL family template. A target adapts it with its own data type and builds its codecs; the template builds none.`,
  );
}

export class SqlTextCodec extends CodecImpl<
  typeof SQL_TEXT_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return sqlTextEncode(value);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return sqlTextDecode(wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class SqlTextDescriptor extends CodecDescriptorTemplateImpl<void> {
  readonly jsonType = 'string' as const;
  override readonly codecId = SQL_TEXT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqlTextCodec {
    return () => unadapted(this.codecId);
  }
}

export const sqlTextDescriptor = new SqlTextDescriptor();

export const sqlTextColumn = () =>
  column(sqlTextDescriptor.factory(), sqlTextDescriptor.codecId, undefined);

sqlTextColumn satisfies ColumnHelperFor<SqlTextDescriptor>;
sqlTextColumn satisfies ColumnHelperForStrict<SqlTextDescriptor>;

export class SqlIntCodec extends CodecImpl<
  typeof SQL_INT_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
> {
  async toWire(value: number, _ctx: CodecCallContext): Promise<number> {
    return sqlIntEncode(value);
  }
  async fromWire(wire: number, _ctx: CodecCallContext): Promise<number> {
    return sqlIntDecode(wire);
  }
  /** A `number` holds an integer exactly only within the safe integer range. */
  fromDataTypeValue(value: DataTypeValue): number {
    return readJsonInteger(this.id, value.value, SAFE_INTEGER_RANGE);
  }
  toDataTypeValue(input: number): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class SqlIntDescriptor extends CodecDescriptorTemplateImpl<void> {
  readonly jsonType = 'number' as const;
  override readonly codecId = SQL_INT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqlIntCodec {
    return () => unadapted(this.codecId);
  }
}

export const sqlIntDescriptor = new SqlIntDescriptor();

export const sqlIntColumn = () =>
  column(sqlIntDescriptor.factory(), sqlIntDescriptor.codecId, undefined);

sqlIntColumn satisfies ColumnHelperFor<SqlIntDescriptor>;
sqlIntColumn satisfies ColumnHelperForStrict<SqlIntDescriptor>;

export class SqlFloatCodec extends CodecImpl<
  typeof SQL_FLOAT_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
> {
  async toWire(value: number, _ctx: CodecCallContext): Promise<number> {
    return sqlFloatEncode(value);
  }
  async fromWire(wire: number, _ctx: CodecCallContext): Promise<number> {
    return sqlFloatDecode(wire);
  }
  fromDataTypeValue(value: DataTypeValue): number {
    return readJsonFloat(this.id, value.value);
  }
  toDataTypeValue(input: number): DataTypeValue {
    return this.dataTypeValueOf(floatToJson(input));
  }
}

export class SqlFloatDescriptor extends CodecDescriptorTemplateImpl<void> {
  readonly jsonType = 'number' as const;
  override readonly codecId = SQL_FLOAT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqlFloatCodec {
    return () => unadapted(this.codecId);
  }
}

export const sqlFloatDescriptor = new SqlFloatDescriptor();

export const sqlFloatColumn = () =>
  column(sqlFloatDescriptor.factory(), sqlFloatDescriptor.codecId, undefined);

sqlFloatColumn satisfies ColumnHelperFor<SqlFloatDescriptor>;
sqlFloatColumn satisfies ColumnHelperForStrict<SqlFloatDescriptor>;

export class SqlCharCodec extends CodecImpl<
  typeof SQL_CHAR_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return sqlCharEncode(value);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return sqlCharDecode(wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class SqlCharDescriptor extends CodecDescriptorTemplateImpl<LengthParams> {
  readonly jsonType = 'string' as const;
  override readonly codecId = SQL_CHAR_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly paramsSchema = undefined;
  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => SqlCharCodec {
    return () => unadapted(this.codecId);
  }
}

export const sqlCharDescriptor = new SqlCharDescriptor();

export const sqlCharColumn = (params: LengthParams = {}) =>
  column(sqlCharDescriptor.factory(params), sqlCharDescriptor.codecId, params);

sqlCharColumn satisfies ColumnHelperFor<SqlCharDescriptor>;
sqlCharColumn satisfies ColumnHelperForStrict<SqlCharDescriptor>;

export class SqlVarcharCodec extends CodecImpl<
  typeof SQL_VARCHAR_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return sqlVarcharEncode(value);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return sqlVarcharDecode(wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class SqlVarcharDescriptor extends CodecDescriptorTemplateImpl<LengthParams> {
  readonly jsonType = 'string' as const;
  override readonly codecId = SQL_VARCHAR_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly paramsSchema = undefined;
  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => SqlVarcharCodec {
    return () => unadapted(this.codecId);
  }
}

export const sqlVarcharDescriptor = new SqlVarcharDescriptor();

export const sqlVarcharColumn = (params: LengthParams = {}) =>
  column(sqlVarcharDescriptor.factory(params), sqlVarcharDescriptor.codecId, params);

sqlVarcharColumn satisfies ColumnHelperFor<SqlVarcharDescriptor>;
sqlVarcharColumn satisfies ColumnHelperForStrict<SqlVarcharDescriptor>;

type RawParams = { readonly sql: string };

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      if (Array.isArray(value)) return value.every(isJsonValue);
      return (
        Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(isJsonValue)
      );
    default:
      return false;
  }
}

/**
 * The codec of a raw column, whose type no other data type claims. Values pass through unchanged and
 * are typed `unknown`, since nothing is known about them beyond what the database returns. A raw
 * column has no literal values, but that is its data type's rule: the data type's reader refuses
 * every value, so `toDataTypeValue` refuses every literal. ADR 273.
 */
export class SqlRawCodec extends CodecImpl<typeof SQL_RAW_CODEC_ID, readonly [], unknown, unknown> {
  async toWire(value: unknown, _ctx: CodecCallContext): Promise<unknown> {
    return value;
  }
  async fromWire(wire: unknown, _ctx: CodecCallContext): Promise<unknown> {
    return wire;
  }
  fromDataTypeValue(value: DataTypeValue): unknown {
    return value.value;
  }
  toDataTypeValue(input: unknown): DataTypeValue {
    if (isJsonValue(input)) return this.dataTypeValueOf(input);
    throw structuredError('RUNTIME.ENCODE_FAILED', `${this.id} writes only JSON values as JSON`, {
      meta: { codecId: this.id },
    });
  }
}

export class SqlRawDescriptor extends CodecDescriptorTemplateImpl<RawParams> {
  readonly jsonType = 'any' as const;
  override readonly codecId = SQL_RAW_CODEC_ID;
  override readonly traits = [] as const;
  override readonly enumRefusal =
    'A raw column has a type Prisma does not interpret, so no member can be written as one of its values. No enum can use the raw codec; use a text enum instead.';
  override readonly paramsSchema = undefined;
  override factory(_params: RawParams): (ctx: CodecInstanceContext) => SqlRawCodec {
    return () => unadapted(this.codecId);
  }
}

export const sqlRawDescriptor = new SqlRawDescriptor();

export const sqlRawColumn = (sql: string) =>
  column(sqlRawDescriptor.factory({ sql }), sqlRawDescriptor.codecId, { sql });

sqlRawColumn satisfies ColumnHelperFor<SqlRawDescriptor>;
sqlRawColumn satisfies ColumnHelperForStrict<SqlRawDescriptor>;
