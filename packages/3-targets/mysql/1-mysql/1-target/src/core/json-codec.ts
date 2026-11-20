/**
 * `mysql/json@1`: a JSON document stored in a `json` column, which MariaDB stores as `longtext` with a `json_valid` check. A row carries the document's JSON text, which MySQL normalises (keys sorted, `1e2` read as `100.0`) and MariaDB keeps as written. A parameter is the JSON text as a plain string, which both servers store as the document. JSON `null` is a document; SQL `NULL` is no value.
 *
 * Neither server compares two documents as values through a plain parameter, so the codec offers no equality and no ordering, as PostgreSQL's `json` offers none.
 */

import type { JsonValue } from '@internal/contract/types';
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
import { findNonJsonValue } from '@internal/type-implementations/json';
import { blindCast } from '@internal/utils/casts';
import { MysqlCodecDescriptor } from './codec-descriptor';
import { MYSQL_JSON_CODEC_ID } from './codec-ids';
import { mysqlJson } from './data-types';
import { errorColumnUnreadable, mysqlError } from './errors';

function documentToWrite(value: JsonValue, ctx: SqlCodecCallContext): JsonValue {
  const found = findNonJsonValue(value);
  if (found === undefined) return value;
  const path = found.path === '' ? 'the root' : found.path;
  const target =
    ctx.column === undefined
      ? `a ${MYSQL_JSON_CODEC_ID} value`
      : `column "${ctx.column.table}"."${ctx.column.name}"`;
  throw mysqlError(
    'RUNTIME.ENCODE_FAILED',
    `Cannot write ${found.received} at ${path} to ${target}, which holds a JSON document.`,
    {
      fix: 'Pass a plain JSON value: objects, arrays, strings, finite numbers, booleans and null. Write a date as an ISO 8601 string, a bigint as a number or decimal text, and leave out a key whose value is undefined.',
      meta: {
        codecId: MYSQL_JSON_CODEC_ID,
        ...(ctx.column === undefined ? {} : { table: ctx.column.table, column: ctx.column.name }),
        received: found.received,
        valuePath: found.path,
      },
    },
  );
}

function documentOfText(text: string, ctx: SqlCodecCallContext): JsonValue {
  try {
    return blindCast<JsonValue, 'JSON.parse of JSON text yields a JSON value'>(JSON.parse(text));
  } catch {
    throw errorColumnUnreadable({
      codecId: MYSQL_JSON_CODEC_ID,
      received: JSON.stringify(text),
      column: ctx.column,
      notA: 'JSON text',
      reads: 'JSON text as the document it holds',
      fix: 'Rewrite the value as JSON text, or read the column as String(storage: text).',
    });
  }
}

export class MysqlJsonCodec extends CodecImpl<
  typeof MYSQL_JSON_CODEC_ID,
  readonly [],
  string,
  JsonValue
> {
  async toWire(value: JsonValue, ctx: SqlCodecCallContext): Promise<string> {
    return JSON.stringify(documentToWrite(value, ctx));
  }
  async fromWire(wire: string, ctx: SqlCodecCallContext): Promise<JsonValue> {
    return documentOfText(wire, ctx);
  }
  fromDataTypeValue(value: DataTypeValue<JsonValue>): JsonValue {
    return value.value;
  }
  toDataTypeValue(input: JsonValue): DataTypeValue {
    return this.dataTypeValueOf(documentToWrite(input, {}));
  }
}

export class MysqlJsonDescriptor extends MysqlCodecDescriptor<void> {
  override readonly dataType = mysqlJson.id;
  override readonly codecId = MYSQL_JSON_CODEC_ID;
  override readonly traits = [] as const;
  override readonly paramsSchema = undefined;
  /** The document's JSON text, which the codec reads as it reads a row. Nested as a document, a JSON string such as `"12"` would reach the codec as the text `12`, which it could not tell from a row's number. */
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'CHAR');
  }
  override factory(): (ctx: CodecInstanceContext) => MysqlJsonCodec {
    return () => new MysqlJsonCodec(this, mysqlJson);
  }
}

export const mysqlJsonDescriptor = new MysqlJsonDescriptor();
