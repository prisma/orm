/**
 * One column per Postgres data type in each parameter shape a contract can hold today, so the
 * planner golden test sees every way a column type is written. A descriptor written out by hand
 * stands where no column helper takes that shape.
 */

import {
  bitColumn,
  boolColumn,
  byteaColumn,
  charColumn,
  dateStringColumn,
  dateTemporalColumn,
  float4Column,
  float8Column,
  int2Column,
  int4Column,
  int8Column,
  intervalColumn,
  jsonbColumn,
  jsonColumn,
  numericColumn,
  textColumn,
  timeStringColumn,
  timestampStringColumn,
  timestampTemporalColumn,
  timestamptzJsDateColumn,
  timestamptzStringColumn,
  timestamptzTemporalColumn,
  timeTemporalColumn,
  timetzColumn,
  varbitColumn,
  varcharColumn,
} from '@internal/adapter-postgres/column-types';
import { vector } from '@internal/extension-pgvector/column-types';
import pgvector from '@internal/extension-pgvector/pack';
import { geometry, geometryColumn } from '@internal/extension-postgis/column-types';
// Lets the declaration of `contract` name postgis's geometry value type (TS2742).
import type {} from '@internal/extension-postgis/geojson';
import postgis from '@internal/extension-postgis/pack';
import {
  autoincrement,
  defineContract,
  field,
  model,
  nativeEnum,
  pg,
} from '@internal/postgres/contract-builder';

const Mood = nativeEnum('Mood', 'happy', 'sad');

const numeric = { codecId: 'pg/numeric@1' } as const;
const char = { codecId: 'sql/char@1' } as const;
const varchar = { codecId: 'sql/varchar@1' } as const;
const bit = { codecId: 'pg/bit@1' } as const;
const varbit = { codecId: 'pg/varbit@1' } as const;
const uuid = { codecId: 'pg/uuid@1' } as const;
const inet = { codecId: 'pg/inet@1' } as const;
const tsquery = { codecId: 'pg/tsquery@1' } as const;

const timestamp3 = {
  codecId: 'pg/timestamp-temporal@1',
  typeParams: { precision: 3 },
} as const;
const timestamptz3 = {
  codecId: 'pg/timestamptz-temporal@1',
  typeParams: { precision: 3 },
} as const;

const pgChar5 = {
  codecId: 'pg/char@1',
  typeParams: { length: 5 },
} as const;
const pgVarchar = { codecId: 'pg/varchar@1' } as const;
const pgInt = { codecId: 'pg/int@1' } as const;
const pgFloat = { codecId: 'pg/float@1' } as const;
const sqlInt = { codecId: 'sql/int@1' } as const;
const sqlFloat = { codecId: 'sql/float@1' } as const;
const sqlText = { codecId: 'sql/text@1' } as const;
const int8Number = { codecId: 'pg/int8number@1' } as const;
const unboundedInt = { codecId: 'pg/unboundedint@1' } as const;

const shortText = {
  kind: 'codec-instance',
  codecId: 'sql/varchar@1',
  typeParams: { length: 255 },
} as const;
const code = {
  kind: 'codec-instance',
  codecId: 'sql/char@1',
  typeParams: {},
} as const;
const id = {
  kind: 'codec-instance',
  codecId: 'pg/uuid@1',
  typeParams: {},
} as const;
const money = {
  kind: 'codec-instance',
  codecId: 'pg/numeric@1',
  typeParams: { precision: 10, scale: 2 },
} as const;
const embedding = {
  kind: 'codec-instance',
  codecId: 'pg/vector@1',
  typeParams: { length: 3 },
} as const;

export const contract = defineContract({
  extensions: { pgvector, postgis },
  types: {
    ShortText: shortText,
    Code: code,
    Id: id,
    Money: money,
    Embedding: embedding,
  },
  models: {
    Scalar: model('Scalar', {
      fields: {
        id: field.column(int4Column).default(autoincrement()).id(),
        text: field.column(textColumn),
        int2: field.column(int2Column),
        int8: field.column(int8Column),
        float4: field.column(float4Column),
        float8: field.column(float8Column),
        bool: field.column(boolColumn),
        numeric: field.column(numeric),
        numericPrecision: field.column(numericColumn(10)),
        numericPrecisionScale: field.column(numericColumn(10, 2)),
        json: field.column(jsonColumn),
        jsonb: field.column(jsonbColumn),
        uuid: field.column(uuid),
        inet: field.column(inet),
        bytea: field.column(byteaColumn),
        date: field.column(dateTemporalColumn),
        tsquery: field.column(tsquery),
        char: field.column(char),
        charLength: field.column(charColumn(5)),
        varchar: field.column(varchar),
        varcharLength: field.column(varcharColumn(255)),
        bit: field.column(bit),
        bitLength: field.column(bitColumn(8)),
        varbit: field.column(varbit),
        varbitLength: field.column(varbitColumn(16)),
        time: field.column(timeTemporalColumn()),
        timePrecision: field.column(timeTemporalColumn(3)),
        timetz: field.column(timetzColumn()),
        timetzPrecision: field.column(timetzColumn(3)),
        timestamp: field.column(timestampTemporalColumn),
        timestampPrecision: field.column(timestamp3),
        timestamptz: field.column(timestamptzTemporalColumn),
        timestamptzPrecision: field.column(timestamptz3),
        interval: field.column(intervalColumn()),
        intervalPrecision: field.column(intervalColumn(3)),
        mood: field.column(pg.enum(Mood)),
        vector: field.column(vector(3)),
        geometry: field.column(geometryColumn),
        geometrySrid: field.column(geometry({ srid: 4326 })),
      },
    }).sql({ table: 'scalar' }),
    OtherCodec: model('OtherCodec', {
      fields: {
        id: field.column(int8Column).default(autoincrement()).id(),
        small: field.column(int2Column).default(autoincrement()),
        pgChar: field.column(pgChar5),
        pgVarchar: field.column(pgVarchar),
        pgInt: field.column(pgInt),
        pgFloat: field.column(pgFloat),
        sqlInt: field.column(sqlInt),
        sqlFloat: field.column(sqlFloat),
        sqlText: field.column(sqlText),
        int8Number: field.column(int8Number),
        unboundedInt: field.column(unboundedInt),
        dateString: field.column(dateStringColumn),
        timeString: field.column(timeStringColumn(3)),
        timestampString: field.column(timestampStringColumn),
        timestamptzString: field.column(timestamptzStringColumn),
        timestamptzDate: field.column(timestamptzJsDateColumn),
      },
    }).sql({ table: 'other_codec' }),
    List: model('List', {
      fields: {
        id: field.column(int4Column).id(),
        text: field.column(textColumn).many(),
        int4: field.column(int4Column).many(),
        numeric: field.column(numeric).many(),
        numericPrecision: field.column(numericColumn(10)).many(),
        numericPrecisionScale: field.column(numericColumn(10, 2)).many(),
        char: field.column(char).many(),
        charLength: field.column(charColumn(5)).many(),
        varchar: field.column(varchar).many(),
        varcharLength: field.column(varcharColumn(255)).many(),
        bit: field.column(bit).many(),
        bitLength: field.column(bitColumn(8)).many(),
        varbitLength: field.column(varbitColumn(16)).many(),
        timePrecision: field.column(timeTemporalColumn(3)).many(),
        timestamptz: field.column(timestamptzTemporalColumn).many(),
        timestamptzPrecision: field.column(timestamptz3).many(),
        interval: field.column(intervalColumn()).many(),
        jsonb: field.column(jsonbColumn).many(),
        uuid: field.column(uuid).many(),
        mood: field.column(pg.enum(Mood)).many(),
        vector: field.column(vector(3)).many(),
        geometrySrid: field.column(geometry({ srid: 4326 })).many(),
      },
    }).sql({ table: 'list' }),
    Alias: model('Alias', {
      fields: {
        id: field.namedType(id).id(),
        shortText: field.namedType(shortText),
        code: field.namedType(code),
        money: field.namedType(money),
        embedding: field.namedType(embedding),
      },
    }).sql({ table: 'alias' }),
  },
});
