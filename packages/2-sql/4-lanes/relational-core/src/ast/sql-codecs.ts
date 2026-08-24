/**
 * The six SQL base codecs (TML-2357).
 *
 * Each codec ships as three artifacts:
 *
 * 1. A `SqlXCodec` class extending {@link CodecImpl} that wraps the module-level encode/decode constants exported from `sql-codec-helpers.ts` (the single source of truth for runtime behaviour). 2. A `SqlXDescriptor` class extending {@link CodecDescriptorImpl} declaring the codec id, traits, target types, params schema, and (where applicable) the emit-path `renderOutputType`. 3. A per-codec column helper (`sqlXColumn`)
 * that calls `descriptor.factory(...)` directly and packages the result into a {@link ColumnSpec} via the framework {@link column} packager. The helper is tied to its descriptor with `satisfies ColumnHelperFor`.
 *
 * After TML-2357 this file is the canonical source of SQL base codec metadata and runtime behaviour — the legacy `mkCodec` / `defineCodec` carriers retired with the deletion sweep.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
  voidParamsSchema,
} from '@internal/framework-components/codec';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type as arktype } from 'arktype';
import {
  SQL_CHAR_CODEC_ID,
  SQL_FLOAT_CODEC_ID,
  SQL_INT_CODEC_ID,
  SQL_TEXT_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
  sqlCharDecode,
  sqlCharEncode,
  sqlCharRenderOutputType,
  sqlFloatDecode,
  sqlFloatDecodeJson,
  sqlFloatEncode,
  sqlFloatEncodeJson,
  sqlIntDecode,
  sqlIntEncode,
  sqlTextDecode,
  sqlTextEncode,
  sqlVarcharDecode,
  sqlVarcharEncode,
  sqlVarcharRenderOutputType,
} from './sql-codec-helpers';

type LengthParams = { readonly length?: number };

const lengthParamsSchema = arktype({
  'length?': 'number.integer > 0',
}) satisfies StandardSchemaV1<LengthParams>;

export class SqlTextCodec extends CodecImpl<
  typeof SQL_TEXT_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return sqlTextEncode(value);
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return sqlTextDecode(wire);
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class SqlTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = SQL_TEXT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqlTextCodec {
    return () => new SqlTextCodec(this);
  }
}

export const sqlTextDescriptor = new SqlTextDescriptor();

export const sqlTextColumn = () =>
  column(sqlTextDescriptor.factory(), sqlTextDescriptor.codecId, undefined, 'text');

sqlTextColumn satisfies ColumnHelperFor<SqlTextDescriptor>;
sqlTextColumn satisfies ColumnHelperForStrict<SqlTextDescriptor>;

export class SqlIntCodec extends CodecImpl<
  typeof SQL_INT_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return sqlIntEncode(value);
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return sqlIntDecode(wire);
  }
  encodeJson(value: number): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number {
    return json as number;
  }
}

export class SqlIntDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = SQL_INT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['int'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqlIntCodec {
    return () => new SqlIntCodec(this);
  }
}

export const sqlIntDescriptor = new SqlIntDescriptor();

export const sqlIntColumn = () =>
  column(sqlIntDescriptor.factory(), sqlIntDescriptor.codecId, undefined, 'int');

sqlIntColumn satisfies ColumnHelperFor<SqlIntDescriptor>;
sqlIntColumn satisfies ColumnHelperForStrict<SqlIntDescriptor>;

export class SqlFloatCodec extends CodecImpl<
  typeof SQL_FLOAT_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return sqlFloatEncode(value);
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return sqlFloatDecode(wire);
  }
  encodeJson(value: number): JsonValue {
    return sqlFloatEncodeJson(value);
  }
  decodeJson(json: JsonValue): number {
    return sqlFloatDecodeJson(json);
  }
}

export class SqlFloatDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = SQL_FLOAT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['float'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqlFloatCodec {
    return () => new SqlFloatCodec(this);
  }
}

export const sqlFloatDescriptor = new SqlFloatDescriptor();

export const sqlFloatColumn = () =>
  column(sqlFloatDescriptor.factory(), sqlFloatDescriptor.codecId, undefined, 'float');

sqlFloatColumn satisfies ColumnHelperFor<SqlFloatDescriptor>;
sqlFloatColumn satisfies ColumnHelperForStrict<SqlFloatDescriptor>;

export class SqlCharCodec extends CodecImpl<
  typeof SQL_CHAR_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return sqlCharEncode(value);
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return sqlCharDecode(wire);
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class SqlCharDescriptor extends CodecDescriptorImpl<LengthParams> {
  override readonly codecId = SQL_CHAR_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly targetTypes = ['char'] as const;
  override readonly paramsSchema: StandardSchemaV1<LengthParams> = lengthParamsSchema;
  override renderOutputType(params: LengthParams): string | undefined {
    return sqlCharRenderOutputType(params);
  }
  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => SqlCharCodec {
    return () => new SqlCharCodec(this);
  }
}

export const sqlCharDescriptor = new SqlCharDescriptor();

export const sqlCharColumn = (params: LengthParams = {}) =>
  column(sqlCharDescriptor.factory(params), sqlCharDescriptor.codecId, params, 'char');

sqlCharColumn satisfies ColumnHelperFor<SqlCharDescriptor>;
sqlCharColumn satisfies ColumnHelperForStrict<SqlCharDescriptor>;

export class SqlVarcharCodec extends CodecImpl<
  typeof SQL_VARCHAR_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return sqlVarcharEncode(value);
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return sqlVarcharDecode(wire);
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class SqlVarcharDescriptor extends CodecDescriptorImpl<LengthParams> {
  override readonly codecId = SQL_VARCHAR_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly targetTypes = ['varchar'] as const;
  override readonly paramsSchema: StandardSchemaV1<LengthParams> = lengthParamsSchema;
  override renderOutputType(params: LengthParams): string | undefined {
    return sqlVarcharRenderOutputType(params);
  }
  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => SqlVarcharCodec {
    return () => new SqlVarcharCodec(this);
  }
}

export const sqlVarcharDescriptor = new SqlVarcharDescriptor();

export const sqlVarcharColumn = (params: LengthParams = {}) =>
  column(sqlVarcharDescriptor.factory(params), sqlVarcharDescriptor.codecId, params, 'varchar');

sqlVarcharColumn satisfies ColumnHelperFor<SqlVarcharDescriptor>;
sqlVarcharColumn satisfies ColumnHelperForStrict<SqlVarcharDescriptor>;
