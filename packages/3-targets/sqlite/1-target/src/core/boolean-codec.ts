/**
 * `sqlite/boolean@1`: a boolean stored as the SQLite integer 0 or 1. `node:sqlite` binds no boolean, so the codec writes the integer, and it reads one from a number, a bigint or decimal text.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
  type DataTypeValue,
  renderTsLiteral,
} from '@internal/framework-components/codec';
import type { ProjectionExpr, SqlCodecCallContext } from '@internal/sql-relational-core/ast';
import { booleanFromInteger, integerFromBoolean } from '@internal/type-implementations/boolean';
import { hexJsonProjection } from './blob-json-projection';
import { SqliteCodecDescriptor } from './codec-descriptor';
import { SQLITE_BOOLEAN_CODEC_ID } from './codec-ids';
import { sqliteBoolean } from './data-types';
import { errorColumnUnreadable, sqliteError } from './errors';

function describeReceived(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function requireBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  throw sqliteError(
    'RUNTIME.ENCODE_FAILED',
    `${SQLITE_BOOLEAN_CODEC_ID} value must be a boolean, got ${describeReceived(value)}`,
    { meta: { codecId: SQLITE_BOOLEAN_CODEC_ID, received: String(value) } },
  );
}

/** A stored value that is neither 0 nor 1, named by its column where the read knows it. */
function errorBooleanUnreadable(wire: unknown, ctx: SqlCodecCallContext): never {
  throw errorColumnUnreadable({
    codecId: SQLITE_BOOLEAN_CODEC_ID,
    received: wire,
    column: ctx.column,
    notA: '0 or 1',
    reads: '0 as false and 1 as true',
  });
}

export class SqliteBooleanCodec extends CodecImpl<
  typeof SQLITE_BOOLEAN_CODEC_ID,
  readonly ['equality', 'boolean'],
  number | bigint | string,
  boolean
> {
  async toWire(value: boolean, _ctx: SqlCodecCallContext): Promise<number> {
    return integerFromBoolean(requireBoolean(value));
  }
  async fromWire(wire: number | bigint | string, ctx: SqlCodecCallContext): Promise<boolean> {
    return booleanFromInteger(wire) ?? errorBooleanUnreadable(wire, ctx);
  }
  fromDataTypeValue(value: DataTypeValue<boolean>): boolean {
    return value.value;
  }
  toDataTypeValue(input: boolean): DataTypeValue {
    return this.dataTypeValueOf(requireBoolean(input));
  }
}

export class SqliteBooleanDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return hexJsonProjection(expression);
  }
  override readonly dataType = sqliteBoolean.id;
  override readonly codecId = SQLITE_BOOLEAN_CODEC_ID;
  readonly jsonType = 'boolean' as const;
  override readonly traits = ['equality', 'boolean'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => SqliteBooleanCodec {
    return () => new SqliteBooleanCodec(this, sqliteBoolean);
  }
}

export const sqliteBooleanDescriptor = new SqliteBooleanDescriptor();

export const sqliteBooleanColumn = () =>
  column(sqliteBooleanDescriptor.factory(), sqliteBooleanDescriptor.codecId, undefined);

sqliteBooleanColumn satisfies ColumnHelperFor<SqliteBooleanDescriptor>;
sqliteBooleanColumn satisfies ColumnHelperForStrict<SqliteBooleanDescriptor>;
