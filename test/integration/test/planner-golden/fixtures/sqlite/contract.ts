/**
 * One column per SQLite codec in each parameter shape a contract can hold today, so the planner
 * golden test sees every way a column type is written. A descriptor written out by hand stands
 * where no column helper exists.
 */

import {
  bigintColumn,
  blobColumn,
  datetimeColumn,
  integerColumn,
  jsonColumn,
  realColumn,
  textColumn,
} from '@internal/adapter-sqlite/column-types';
import { autoincrement, defineContract, field, model } from '@internal/sqlite/contract-builder';

const bigintNumber = { codecId: 'sqlite/bigintnumber@1' } as const;
const sqlInt = { codecId: 'sql/int@1' } as const;
const sqlFloat = { codecId: 'sql/float@1' } as const;
const char = { codecId: 'sql/char@1' } as const;
const charLength = {
  codecId: 'sql/char@1',
  typeParams: { length: 36 },
} as const;
const varchar = { codecId: 'sql/varchar@1' } as const;
const varcharLength = {
  codecId: 'sql/varchar@1',
  typeParams: { length: 255 },
} as const;
const shortText = { kind: 'codec-instance', ...varcharLength } as const;

export const contract = defineContract({
  types: {
    ShortText: shortText,
  },
  models: {
    Scalar: model('Scalar', {
      fields: {
        id: field.column(integerColumn).default(autoincrement()).id(),
        text: field.column(textColumn),
        integer: field.column(integerColumn),
        real: field.column(realColumn),
        blob: field.column(blobColumn),
        datetime: field.column(datetimeColumn),
        json: field.column(jsonColumn),
        bigint: field.column(bigintColumn),
        bigintNumber: field.column(bigintNumber),
        sqlInt: field.column(sqlInt),
        sqlFloat: field.column(sqlFloat),
        char: field.column(char),
        charLength: field.column(charLength),
        varchar: field.column(varchar),
        varcharLength: field.column(varcharLength),
        shortText: field.namedType(shortText),
      },
    }).sql({ table: 'scalar' }),
  },
});
