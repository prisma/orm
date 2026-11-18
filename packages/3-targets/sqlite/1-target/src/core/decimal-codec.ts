/**
 * `sqlite/decimal@1`: a decimal stored as SQLite text and read as that text. SQLite has no decimal type, so the column compares by the text's characters: the codec offers equality and nothing that needs the values' order.
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
import { isDecimalText, printedDecimalText } from '@internal/type-implementations/decimal';
import { SqliteCodecDescriptor } from './codec-descriptor';
import { SQLITE_DECIMAL_CODEC_ID } from './codec-ids';
import { sqliteDecimal } from './data-types';
import { sqliteError } from './errors';

const EXPECTED = 'decimal text, such as "12.50"';

function describeReceived(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** The decimal text the codec writes for an application value: the value without leading zeros or a minus sign on zero. */
function storedDecimalText(value: unknown): string {
  if (typeof value === 'string' && isDecimalText(value)) return printedDecimalText(value);
  throw sqliteError(
    'RUNTIME.ENCODE_FAILED',
    `${SQLITE_DECIMAL_CODEC_ID} value must be ${EXPECTED}, got ${describeReceived(value)}`,
    { meta: { codecId: SQLITE_DECIMAL_CODEC_ID, received: String(value) } },
  );
}

/** A stored value the codec cannot read, such as the empty text an earlier fill wrote into a new column, named by its column where the read knows it. */
function errorDecimalUnreadable(wire: unknown, ctx: SqlCodecCallContext): never {
  const column = ctx.column;
  const holder =
    column === undefined
      ? `A ${SQLITE_DECIMAL_CODEC_ID} value is ${describeReceived(wire)}`
      : `Column "${column.table}"."${column.name}" holds ${describeReceived(wire)}`;
  throw sqliteError(
    'RUNTIME.DECODE_FAILED',
    `${holder}, which is not decimal text. ${SQLITE_DECIMAL_CODEC_ID} reads ${EXPECTED}.`,
    {
      meta: {
        codecId: SQLITE_DECIMAL_CODEC_ID,
        ...(column === undefined ? {} : { table: column.table, column: column.name }),
        received: String(wire),
      },
    },
  );
}

export class SqliteDecimalCodec extends CodecImpl<
  typeof SQLITE_DECIMAL_CODEC_ID,
  readonly ['equality'],
  string,
  string
> {
  async toWire(value: string, _ctx: SqlCodecCallContext): Promise<string> {
    return storedDecimalText(value);
  }
  async fromWire(wire: string, ctx: SqlCodecCallContext): Promise<string> {
    if (typeof wire === 'string' && isDecimalText(wire)) return wire;
    return errorDecimalUnreadable(wire, ctx);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(storedDecimalText(input));
  }
}

export class SqliteDecimalDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = sqliteDecimal.id;
  override readonly codecId = SQLITE_DECIMAL_CODEC_ID;
  readonly jsonType = 'string' as const;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => SqliteDecimalCodec {
    return () => new SqliteDecimalCodec(this, sqliteDecimal);
  }
}

export const sqliteDecimalDescriptor = new SqliteDecimalDescriptor();

export const sqliteDecimalColumn = () =>
  column(sqliteDecimalDescriptor.factory(), sqliteDecimalDescriptor.codecId, undefined);

sqliteDecimalColumn satisfies ColumnHelperFor<SqliteDecimalDescriptor>;
sqliteDecimalColumn satisfies ColumnHelperForStrict<SqliteDecimalDescriptor>;
