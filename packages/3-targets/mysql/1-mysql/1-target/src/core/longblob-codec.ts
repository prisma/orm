/**
 * `mysql/longblob@1`: bytes stored as `longblob`, read and written as a `Uint8Array`. A row carries the bytes. MySQL writes a blob into JSON as `"base64:type251:…"` and MariaDB as raw bytes, so an include projects the column as `TO_BASE64(v)`, which both servers write as plain base64 with a line break after every 76 characters, and the codec decodes it.
 */

import {
  CodecImpl,
  type CodecInstanceContext,
  type DataTypeValue,
} from '@internal/framework-components/codec';
import {
  FunctionCallExpr,
  type ProjectionExpr,
  type SqlCodecCallContext,
} from '@internal/sql-relational-core/ast';
import { MysqlCodecDescriptor } from './codec-descriptor';
import { MYSQL_LONGBLOB_CODEC_ID } from './codec-ids';
import { mysqlLongblob } from './data-types';
import { errorColumnUnreadable, errorColumnUnwritable } from './errors';

const LINE_BREAKS = /\r?\n/g;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function describeReceived(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function bytesToWrite(value: unknown, ctx: SqlCodecCallContext): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw errorColumnUnwritable({
    codecId: MYSQL_LONGBLOB_CODEC_ID,
    received: describeReceived(value),
    column: ctx.column,
    holds: 'bytes, written as a Uint8Array',
    fix: 'Pass the bytes as a Uint8Array, such as new TextEncoder().encode(text) for the UTF-8 bytes of text.',
  });
}

/** A `Uint8Array` that is not a subclass such as Node's `Buffer`, over the same memory. */
function plainBytes(bytes: Uint8Array): Uint8Array {
  return bytes.constructor === Uint8Array
    ? bytes
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function bytesOfBase64(text: string, ctx: SqlCodecCallContext): Uint8Array {
  const base64 = text.replace(LINE_BREAKS, '');
  if (BASE64.test(base64)) return plainBytes(Buffer.from(base64, 'base64'));
  throw errorColumnUnreadable({
    codecId: MYSQL_LONGBLOB_CODEC_ID,
    received: describeReceived(text),
    column: ctx.column,
    notA: 'base64 text',
    reads: "a row's bytes, and in an include the base64 text TO_BASE64 writes",
    fix: 'Read the column with its own query.',
  });
}

export class MysqlLongblobCodec extends CodecImpl<
  typeof MYSQL_LONGBLOB_CODEC_ID,
  readonly ['equality', 'order'],
  Uint8Array | string,
  Uint8Array
> {
  async toWire(value: Uint8Array, ctx: SqlCodecCallContext): Promise<Uint8Array> {
    return bytesToWrite(value, ctx);
  }
  async fromWire(wire: Uint8Array | string, ctx: SqlCodecCallContext): Promise<Uint8Array> {
    return wire instanceof Uint8Array ? plainBytes(wire) : bytesOfBase64(wire, ctx);
  }
  fromDataTypeValue(value: DataTypeValue<string>): Uint8Array {
    return plainBytes(Buffer.from(value.value, 'hex'));
  }
  toDataTypeValue(input: Uint8Array): DataTypeValue {
    return this.dataTypeValueOf(Buffer.from(bytesToWrite(input, {})).toString('hex').toUpperCase());
  }
}

export class MysqlLongblobDescriptor extends MysqlCodecDescriptor<void> {
  override readonly dataType = mysqlLongblob.id;
  override readonly codecId = MYSQL_LONGBLOB_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return FunctionCallExpr.of('TO_BASE64', [expression]);
  }
  override factory(): (ctx: CodecInstanceContext) => MysqlLongblobCodec {
    return () => new MysqlLongblobCodec(this, mysqlLongblob);
  }
}

export const mysqlLongblobDescriptor = new MysqlLongblobDescriptor();
