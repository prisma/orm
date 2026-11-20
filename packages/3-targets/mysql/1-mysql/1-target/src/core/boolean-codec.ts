/**
 * `mysql/boolean@1`: a boolean stored as `tinyint(1)` holding 0 or 1. MySQL and MariaDB store any `tinyint` in the column, but `= TRUE` and a `true` parameter match only 1, so the codec reads 0 and 1 and refuses any other value rather than read a row as `true` that a filter on `true` does not find.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  CodecImpl,
  type CodecInstanceContext,
  type DataTypeValue,
  renderTsLiteral,
} from '@internal/framework-components/codec';
import type { ProjectionExpr, SqlCodecCallContext } from '@internal/sql-relational-core/ast';
import { booleanFromInteger, integerFromBoolean } from '@internal/type-implementations/boolean';
import { identityJsonProjection, MysqlCodecDescriptor } from './codec-descriptor';
import { MYSQL_BOOLEAN_CODEC_ID } from './codec-ids';
import { mysqlBoolean } from './data-types';
import { errorColumnUnreadable, errorColumnUnwritable } from './errors';

function booleanToWrite(value: unknown, ctx: SqlCodecCallContext): boolean {
  if (typeof value === 'boolean') return value;
  throw errorColumnUnwritable({
    codecId: MYSQL_BOOLEAN_CODEC_ID,
    received: JSON.stringify(value) ?? String(value),
    column: ctx.column,
    holds: 'true or false, stored as 1 or 0',
    fix: 'Write true or false.',
  });
}

/** A row carries the stored integer as decimal text, and an include's JSON as a number. */
export class MysqlBooleanCodec extends CodecImpl<
  typeof MYSQL_BOOLEAN_CODEC_ID,
  readonly ['equality', 'boolean'],
  string | number,
  boolean
> {
  async toWire(value: boolean, ctx: SqlCodecCallContext): Promise<number> {
    return integerFromBoolean(booleanToWrite(value, ctx));
  }
  async fromWire(wire: string | number, ctx: SqlCodecCallContext): Promise<boolean> {
    const value = booleanFromInteger(wire);
    if (value !== undefined) return value;
    throw errorColumnUnreadable({
      codecId: MYSQL_BOOLEAN_CODEC_ID,
      received: String(wire),
      column: ctx.column,
      notA: '0 or 1',
      reads: '0 as false and 1 as true',
      fix: 'Rewrite the value as 0 or 1. MySQL and MariaDB store any tinyint in the column, but only 1 equals TRUE.',
    });
  }
  fromDataTypeValue(value: DataTypeValue<boolean>): boolean {
    return value.value;
  }
  toDataTypeValue(input: boolean): DataTypeValue {
    return this.dataTypeValueOf(booleanToWrite(input, {}));
  }
}

export class MysqlBooleanDescriptor extends MysqlCodecDescriptor<void> {
  override readonly dataType = mysqlBoolean.id;
  override readonly codecId = MYSQL_BOOLEAN_CODEC_ID;
  override readonly traits = ['equality', 'boolean'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  /** The stored integer as a JSON number, which the codec checks as it checks a row. */
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return identityJsonProjection(expression);
  }
  override factory(): (ctx: CodecInstanceContext) => MysqlBooleanCodec {
    return () => new MysqlBooleanCodec(this, mysqlBoolean);
  }
}

export const mysqlBooleanDescriptor = new MysqlBooleanDescriptor();
