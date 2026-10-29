import {
  int8Column,
  textColumn,
  timeTemporalColumn,
  varcharColumn,
} from '@internal/adapter-postgres/column-types';
import { test } from 'vitest';
import {
  defineContract,
  enumType,
  field as importedField,
  member,
  now,
  type ScalarFieldBuilder,
  sql,
} from '../../src/exports/contract-builder';

const Level = enumType(
  'Level',
  { codecId: 'pg/int4@1' as const },
  member('Low', 1),
  member('High', 10),
);
const BigLevel = enumType('BigLevel', { codecId: 'pg/int8@1' as const }, member('Low', 1n));

const handWritten = { codecId: 'app/custom@1' } as const;

test('.default() takes the input type of the field codec', () => {
  defineContract({ enums: { Level, BigLevel } }, ({ field, model, gen, type }) => {
    const Counter = field.column({
      kind: 'codec-instance',
      codecId: 'pg/int8@1',
      typeParams: {},
    } as const);
    return {
      models: {
        Accepted: model('Accepted', {
          fields: {
            id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
            instant: field
              .column(type.TimestamptzTemporal())
              .default(Temporal.Instant.from('2024-01-01T00:00:00Z')),
            big: field.column(type.BigInt()).default(1n),
            bytes: field.column(type.Bytes()).default(new Uint8Array([120])),
            text: field.column(type.String()).default('x'),
            jsDate: field.column(type.TimestamptzJsDate()).default(new Date()),
            isoString: field.column(type.TimestamptzString()).default('2024-01-01T00:00:00Z'),
            generatedNow: field.column(type.TimestamptzTemporal()).default(now()),
            rawSql: field.column(type.String()).default(sql`'x'`),
            optionalThenDefault: field.column(type.BigInt()).optional().default(1n),
            list: field.column(type.BigInt()).many().default([1n, 2n]),
            nullableElements: field
              .column(type.BigInt())
              .many({ elementsNullable: true })
              .default([1n, null]),
            nullableList: field.column(type.BigInt()).many().optional().default(null),
            nullableEnumElements: field
              .namedType(Level)
              .many({ elementsNullable: true })
              .default([Level.members.Low, null]),
            level: field.namedType(Level).default(Level.members.Low),
            bigLevel: field.namedType(BigLevel).default(BigLevel.members.Low),
            levels: field.namedType(Level).many().default([Level.members.Low, Level.members.High]),
            varchar: field.column(varcharColumn(3)).default('abc'),
            time: field.column(timeTemporalColumn()).default(Temporal.PlainTime.from('12:00')),
            column: field.column(int8Column).default(1n),
            aliasConstant: Counter.default(1n),
            handWritten: field.column(handWritten).default('anything JSON'),
          },
        }),
        Refused: model('Refused', {
          fields: {
            id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
            // @ts-expect-error pg/timestamptz-temporal@1 takes a Temporal.Instant, not a string
            instant: field.column(type.TimestamptzTemporal()).default('2024-01-01'),
            // @ts-expect-error pg/text@1 takes a string, not a number
            text: field.column(type.String()).default(1),
            // @ts-expect-error pg/int8@1 takes a bigint, not a number
            big: field.column(type.BigInt()).default(1),
            // @ts-expect-error pg/bytea@1 takes a Uint8Array, not a string
            bytes: field.column(type.Bytes()).default('x'),
            // @ts-expect-error pg/timestamptz-date@1 takes a Date, not a string
            jsDate: field.column(type.TimestamptzJsDate()).default('2024-01-01T00:00:00Z'),
            // @ts-expect-error pg/timestamptz-string@1 takes a string, not a Date
            isoString: field.column(type.TimestamptzString()).default(new Date()),
            // @ts-expect-error a list field takes an array
            list: field.column(type.BigInt()).many().default(1n),
            // @ts-expect-error an enum field takes one of its member values
            level: field.namedType(Level).default(2),
            // @ts-expect-error an enum list field takes an array of member values
            levels: field.namedType(Level).many().default(Level.members.Low),
            // @ts-expect-error 2 is not a member value of Level
            otherLevels: field.namedType(Level).many().default([2]),
            // @ts-expect-error sql/varchar@1 takes a string, not a number
            varchar: field.column(varcharColumn(3)).default(1),
            // @ts-expect-error pg/time-temporal@1 takes a Temporal.PlainTime, not a string
            time: field.column(timeTemporalColumn()).default('12:00'),
            // @ts-expect-error pg/text@1 takes a string, not a number
            column: field.column(textColumn).default(1),
            // @ts-expect-error pg/int8@1 takes a bigint, not a string
            aliasConstant: Counter.default('1'),
          },
        }),
      },
    };
  });
});

test('the directly imported field checks values against the column type, like the callback field', () => {
  importedField.column(int8Column).default(1n);
  // @ts-expect-error pg/int8@1 takes a bigint, not bytes
  importedField.column(int8Column).default(new Uint8Array([120]));
});

test('a builder held as the bare ScalarFieldBuilder type accepts any value', () => {
  const builder: ScalarFieldBuilder = importedField.column(int8Column);
  builder.default(1n);
  builder.default({ kind: 'function', expression: 'now()' });
});
