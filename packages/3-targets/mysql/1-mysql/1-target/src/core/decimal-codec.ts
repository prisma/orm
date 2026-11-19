/**
 * `mysql/decimal@1`: an exact decimal number read as the text MySQL and MariaDB print for it, padded to the column's scale.
 *
 * Both servers compare a text parameter with a `decimal` column as a decimal only when the column stands alone beside `=`, `<` or `>`; inside `IN`, beside an expression, and in MariaDB's `BETWEEN`, they compare it as a double. So every parameter of this codec is cast to a `DECIMAL(65, s)` that holds every value of its column, which compares exactly in every form. The cast rounds text with more digits after the point than `s` and clamps text with more before it than `65 - s`, so the codec refuses to write such text.
 */

import {
  CodecImpl,
  type CodecInstanceContext,
  type DataTypeParams,
  type DataTypeValue,
} from '@internal/framework-components/codec';
import {
  type AnyExpression,
  type AnyParamRef,
  CastExpr,
  type ProjectionExpr,
  type SqlCodecCallContext,
} from '@internal/sql-relational-core/ast';
import { isDecimalText, printedDecimalText } from '@internal/type-implementations/decimal';
import { MysqlCodecDescriptor } from './codec-descriptor';
import { MYSQL_DECIMAL_CODEC_ID } from './codec-ids';
import {
  decimalTextDigits,
  MYSQL_WIDEST_DECIMAL,
  mysqlDecimal,
  mysqlDecimalParams,
} from './data-types';
import { errorColumnUnreadable, errorColumnUnwritable } from './errors';

type DecimalParams = typeof mysqlDecimalParams.infer;

/** The digits before and after the point of the `DECIMAL(65, fraction)` a parameter of a column with `params` is cast to: as many after the point as MySQL allows, 30, unless the column needs more than 35 before it. */
function decimalParameterDigits(params: DataTypeParams): {
  readonly integer: number;
  readonly fraction: number;
} {
  const column = mysqlDecimal.sql.normalize(params);
  const { precision: widest, scale: finest } = MYSQL_WIDEST_DECIMAL;
  const columnInteger = Number(column['precision']) - Number(column['scale']);
  const fraction = Math.min(finest, widest - columnInteger);
  return { integer: widest - fraction, fraction };
}

/** The type a parameter of a column with `params` is cast to. */
function decimalParameterType(params: DataTypeParams): string {
  return `DECIMAL(${MYSQL_WIDEST_DECIMAL.precision},${decimalParameterDigits(params).fraction})`;
}

const EXAMPLE = 'decimal text, such as "12.50"';

function describeReceived(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function digitsAfterPoint(count: number): string {
  return count === 0 ? 'none after it' : `${count} after it`;
}

/** The text the codec sends for an application value: decimal text without leading zeros or a minus sign on zero, which the parameter's cast holds exactly. */
function parameterText(value: unknown, params: DataTypeParams, ctx: SqlCodecCallContext): string {
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
  const { integer, fraction } = decimalParameterDigits(params);
  if (digits.integer > integer || digits.fraction > fraction) {
    throw errorColumnUnwritable({
      codecId: MYSQL_DECIMAL_CODEC_ID,
      received: describeReceived(value),
      column: ctx.column,
      holds: `a decimal number of at most ${integer} digits before the point and ${digitsAfterPoint(fraction)}`,
      fix: `${fraction === 0 ? 'Round the value to a whole number' : `Round the value to at most ${fraction} digits after the point`}, and keep it below 10^${integer}.`,
    });
  }
  return printed;
}

export class MysqlDecimalCodec extends CodecImpl<
  typeof MYSQL_DECIMAL_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  string,
  string
> {
  async toWire(value: string, ctx: SqlCodecCallContext): Promise<string> {
    return parameterText(value, this.dataTypeParams, ctx);
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
  protected override wrappedParameter(
    parameter: AnyParamRef,
    params: DecimalParams | undefined,
  ): AnyExpression {
    return CastExpr.as(parameter, decimalParameterType(params ?? {}));
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
