/**
 * The six SQL base codecs (TML-2357).
 *
 * Each codec ships as two artifacts:
 *
 * 1. A `SqlXCodec` class extending {@link CodecImpl} that wraps the module-level wire conversions exported from `sql-codec-helpers.ts` (the single source of truth for runtime behaviour). 2. A `SqlXDescriptor` class extending {@link CodecDescriptorTemplateImpl} declaring the codec id, traits, params schema, and (where applicable) the emit-path `renderOutputType`; the data type is left to the target that adapts the template, which builds the codec with that type.
 *
 * After TML-2357 this file is the canonical source of SQL base codec metadata and runtime behaviour — the legacy `mkCodec` / `defineCodec` carriers retired with the deletion sweep.
 */

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
  sqlFloatEncode,
  sqlIntDecode,
  sqlIntEncode,
  sqlTextDecode,
  sqlTextEncode,
  sqlVarcharDecode,
  sqlVarcharEncode,
  sqlVarcharRenderOutputType,
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
  override readonly codecId = SQL_CHAR_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly paramsSchema = undefined;
  override renderOutputType(params: LengthParams): string | undefined {
    return sqlCharRenderOutputType(params);
  }
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
  override readonly codecId = SQL_VARCHAR_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly paramsSchema = undefined;
  override renderOutputType(params: LengthParams): string | undefined {
    return sqlVarcharRenderOutputType(params);
  }
  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => SqlVarcharCodec {
    return () => unadapted(this.codecId);
  }
}

export const sqlVarcharDescriptor = new SqlVarcharDescriptor();

export const sqlVarcharColumn = (params: LengthParams = {}) =>
  column(sqlVarcharDescriptor.factory(params), sqlVarcharDescriptor.codecId, params);

sqlVarcharColumn satisfies ColumnHelperFor<SqlVarcharDescriptor>;
sqlVarcharColumn satisfies ColumnHelperForStrict<SqlVarcharDescriptor>;
