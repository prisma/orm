/**
 * `mysql/decimal@1`: an exact decimal number read as the text MySQL and MariaDB print for it, padded to the column's scale.
 *
 * Both servers compare a text parameter with a `decimal` column as a decimal only when the column stands alone beside `=`, `<` or `>`; inside `IN`, beside an expression, and in MariaDB's `BETWEEN`, they compare it as a double. So every parameter of this codec is written `CAST(?N AS DECIMAL(65,30))`, which compares exactly in every form. The cast rounds text with more than 30 digits after the point and clamps text with more than 35 before it, so the codec refuses to write such text.
 */

import {
  CodecImpl,
  type CodecInstanceContext,
  type DataTypeValue,
} from '@internal/framework-components/codec';
import {
  CastExpr,
  type ProjectionExpr,
  type SqlCodecCallContext,
} from '@internal/sql-relational-core/ast';
import { isDecimalText, printedDecimalText } from '@internal/type-implementations/decimal';
import { MysqlCodecDescriptor } from './codec-descriptor';
import { MYSQL_DECIMAL_CODEC_ID } from './codec-ids';
import { decimalTextDigits, mysqlDecimal, mysqlDecimalParams } from './data-types';
import { errorColumnUnreadable, errorColumnUnwritable } from './errors';

/** The most digits a parameter has before and after the point: what `DECIMAL(65,30)` holds. */
export const MYSQL_DECIMAL_PARAMETER_DIGITS = { integer: 35, fraction: 30 } as const;

const PARAMETER_TYPE = 'DECIMAL(65,30)';

const EXAMPLE = 'decimal text, such as "12.50"';

function describeReceived(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** The text the codec sends for an application value: decimal text without leading zeros or a minus sign on zero, which `DECIMAL(65,30)` holds exactly. */
function parameterText(value: unknown, ctx: SqlCodecCallContext): string {
  if (typeof value !== 'string' || !isDecimalText(value)) {
    throw errorColumnUnwritable({
      codecId: MYSQL_DECIMAL_CODEC_ID,
      received: describeReceived(value),
      column: ctx.column,
      holds: EXAMPLE,
      fix: 'Pass the value as decimal text: an optional minus sign, digits, and an optional point and digits after it, with no exponent.',
    });
  }
  const printed = printedDecimalText(value);
  const digits = decimalTextDigits(printed);
  const { integer, fraction } = MYSQL_DECIMAL_PARAMETER_DIGITS;
  if (digits.integer > integer || digits.fraction > fraction) {
    throw errorColumnUnwritable({
      codecId: MYSQL_DECIMAL_CODEC_ID,
      received: describeReceived(value),
      column: ctx.column,
      holds: `a decimal number of at most ${integer} digits before the point and ${fraction} after it`,
      fix: `Round the value to at most ${fraction} digits after the point, and keep it below 10^${integer}.`,
    });
  }
  return printed;
}

type DecimalParams = typeof mysqlDecimalParams.infer;

export class MysqlDecimalCodec extends CodecImpl<
  typeof MYSQL_DECIMAL_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  string,
  string
> {
  async toWire(value: string, ctx: SqlCodecCallContext): Promise<string> {
    return parameterText(value, ctx);
  }
  async fromWire(wire: string, ctx: SqlCodecCallContext): Promise<string> {
    if (typeof wire === 'string' && isDecimalText(wire)) return wire;
    throw errorColumnUnreadable({
      codecId: MYSQL_DECIMAL_CODEC_ID,
      received: describeReceived(wire),
      column: ctx.column,
      notA: 'decimal text',
      reads: EXAMPLE,
      fix: 'Read the column with a type that holds its value, or rewrite the row with a decimal number.',
    });
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class MysqlDecimalDescriptor extends MysqlCodecDescriptor<DecimalParams> {
  override readonly dataType = mysqlDecimal.id;
  override readonly codecId = MYSQL_DECIMAL_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly keepsWrittenForm = true as const;
  override readonly paramsSchema = mysqlDecimalParams;
  override writeParameter(placeholder: string): string {
    return `CAST(${placeholder} AS ${PARAMETER_TYPE})`;
  }
  /** The decimal text: a JSON number would lose every digit past a double's precision when the include is parsed. */
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'CHAR');
  }
  override factory(params: DecimalParams): (ctx: CodecInstanceContext) => MysqlDecimalCodec {
    return () => new MysqlDecimalCodec(this, mysqlDecimal, params ?? {});
  }
}

export const mysqlDecimalDescriptor = new MysqlDecimalDescriptor();
