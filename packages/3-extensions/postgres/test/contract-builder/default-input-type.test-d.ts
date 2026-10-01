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
  { codecId: 'pg/int4@1' as const, nativeType: 'int4' },
  member('Low', 1),
  member('High', 10),
);
const BigLevel = enumType(
  'BigLevel',
  { codecId: 'pg/int8@1' as const, nativeType: 'int8' },
  member('Low', 1n),
);

const handWritten = { codecId: 'app/custom@1', nativeType: 'text' } as const;

test('.default() takes the input type of the field codec', () => {
  defineContract({ enums: { Level, BigLevel } }, ({ field, model }) => {
    const types = {
      Counter: {
        kind: 'codec-instance',
        codecId: 'pg/int8@1',
        nativeType: 'int8',
        typeParams: {},
      },
    } as const;
    return {
      models: {
        Accepted: model('Accepted', {
          fields: {
            id: field.id.uuidv4String(),
            instant: field.dateTime().default(Temporal.Instant.from('2024-01-01T00:00:00Z')),
            big: field.bigint().default(1n),
            bytes: field.bytes().default(new Uint8Array([120])),
            text: field.text().default('x'),
            jsDate: field.temporal.timestamptzJsDate().default(new Date()),
            isoString: field.temporal.timestamptzString().default('2024-01-01T00:00:00Z'),
            generatedNow: field.dateTime().default(now()),
            rawSql: field.text().default(sql`'x'`),
            optionalThenDefault: field.bigint().optional().default(1n),
            list: field.bigint().many().default([1n, 2n]),
            level: field.namedType(Level).default(Level.members.Low),
            bigLevel: field.namedType(BigLevel).default(BigLevel.members.Low),
            levels: field.namedType(Level).many().default([Level.members.Low, Level.members.High]),
            varchar: field.column(varcharColumn(3)).default('abc'),
            time: field.column(timeTemporalColumn()).default(Temporal.PlainTime.from('12:00')),
            column: field.column(int8Column).default(1n),
            namedType: field.namedType(types.Counter).default(1n),
            handWritten: field.column(handWritten).default('anything JSON'),
          },
        }),
        Refused: model('Refused', {
          fields: {
            id: field.id.uuidv4String(),
            // @ts-expect-error pg/timestamptz-temporal@1 takes a Temporal.Instant, not a string
            instant: field.dateTime().default('2024-01-01'),
            // @ts-expect-error pg/text@1 takes a string, not a number
            text: field.text().default(1),
            // @ts-expect-error pg/int8@1 takes a bigint, not a number
            big: field.bigint().default(1),
            // @ts-expect-error pg/bytea@1 takes a Uint8Array, not a string
            bytes: field.bytes().default('x'),
            // @ts-expect-error pg/timestamptz-date@1 takes a Date, not a string
            jsDate: field.temporal.timestamptzJsDate().default('2024-01-01T00:00:00Z'),
            // @ts-expect-error pg/timestamptz-string@1 takes a string, not a Date
            isoString: field.temporal.timestamptzString().default(new Date()),
            // @ts-expect-error a list field takes an array
            list: field.bigint().many().default(1n),
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
            namedType: field.namedType(types.Counter).default('1'),
          },
        }),
      },
      types,
    };
  });
});

test('the directly imported field accepts any value, which the build checks', () => {
  importedField.column(int8Column).default(1n);
  importedField.column(int8Column).default(new Uint8Array([120]));
  importedField.namedType('Counter').default(1n);
});

test('a builder held as the bare ScalarFieldBuilder type accepts any value', () => {
  const builder: ScalarFieldBuilder = importedField.column(int8Column);
  builder.default(1n);
  builder.default({ kind: 'function', expression: 'now()' });
});
