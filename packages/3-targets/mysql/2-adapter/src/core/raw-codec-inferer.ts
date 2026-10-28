import type { RawSqlLiteral } from '@internal/sql-relational-core/ast';
import type { RawCodecInferer } from '@internal/sql-relational-core/expression';
import {
  MYSQL_BIGINT_CODEC_ID,
  MYSQL_INT_CODEC_ID,
  MYSQL_TEXT_CODEC_ID,
} from '@internal/target-mysql/codec-ids';
import { structuredError } from '@internal/utils/structured-error';

const INT_MIN = -(2 ** 31);
const INT_MAX = 2 ** 31 - 1;

function refuse(value: RawSqlLiteral): never {
  throw structuredError(
    'RUNTIME.RAW_SQL_UNSUPPORTED_INTERPOLATION',
    'MySQL has no codec for this JS value in raw SQL: wrap it in `param(...)` with an explicit codec',
    { meta: { valueType: typeof value } },
  );
}

/** The codec of a bare value interpolated into `fns.raw` or the raw lane on a MySQL client: integers, bigints and strings. */
export const mysqlRawCodecInferer: RawCodecInferer = {
  inferCodec(value: RawSqlLiteral): string {
    switch (typeof value) {
      case 'number':
        if (!Number.isSafeInteger(value)) return refuse(value);
        return value >= INT_MIN && value <= INT_MAX ? MYSQL_INT_CODEC_ID : refuse(value);
      case 'bigint':
        return MYSQL_BIGINT_CODEC_ID;
      case 'string':
        return MYSQL_TEXT_CODEC_ID;
      default:
        return refuse(value);
    }
  },
};
