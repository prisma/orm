import mysqlAdapter from '@internal/adapter-mysql/control';
import mysqlDriver from '@internal/driver-mysql/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import mysql from '@internal/target-mysql/control';
import mysqlPackRef from '@internal/target-mysql/pack';
import { mysqlCreateNamespace } from '@internal/target-mysql/types';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';

const stack = createControlStack({
  family: sql,
  target: mysql,
  adapter: mysqlAdapter,
  driver: mysqlDriver,
});

function emit(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'convenience-date-time-types.test.psl',
    context: contractSourceContextFromControlStack(stack),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: mysqlPackRef,
      createNamespace: mysqlCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

const model = (...fields: readonly string[]) =>
  [
    'model Event {',
    '  id Int @id',
    ...fields.map((f) => `  ${f}`),
    '',
    '  @@map("event")',
    '}',
    '',
  ].join('\n');

function emitted(schema: string): string {
  const result = emit(schema);
  if (!result.ok) throw new Error(JSON.stringify(result.failure));
  return JSON.stringify(result.value);
}

function failure(schema: string): string {
  const result = emit(schema);
  return result.ok ? '' : JSON.stringify(result.failure);
}

const rows: readonly (readonly [
  convenience: string,
  explicit: string,
  codecId: string,
  typeParams: Readonly<Record<string, number>> | undefined,
])[] = [
  ['DateTime', 'DatetimeJsDate(3)', 'mysql/datetime@1', { precision: 3 }],
  [
    'DateTime(as: jsDate, storage: datetime)',
    'DatetimeJsDate(3)',
    'mysql/datetime@1',
    { precision: 3 },
  ],
  ['DateTime(precision: 6)', 'DatetimeJsDate(6)', 'mysql/datetime@1', { precision: 6 }],
  ['DateTime(as: temporal)', 'DatetimeTemporal(6)', 'mysql/datetime-temporal@1', { precision: 6 }],
  ['DateTime(as: string)', 'DatetimeString(6)', 'mysql/datetime-string@1', { precision: 6 }],
  [
    'DateTime(storage: timestamp)',
    'TimestampJsDate(3)',
    'mysql/timestamp-date@1',
    { precision: 3 },
  ],
  [
    'DateTime(as: temporal, storage: timestamp)',
    'TimestampTemporal(6)',
    'mysql/timestamp-temporal@1',
    { precision: 6 },
  ],
  [
    'DateTime(as: string, storage: timestamp, precision: 0)',
    'TimestampString(0)',
    'mysql/timestamp-string@1',
    { precision: 0 },
  ],
  ['Date', 'DateString', 'mysql/date-string@1', undefined],
  ['Date(as: temporal)', 'DateTemporal', 'mysql/date-temporal@1', undefined],
  ['Time', 'TimeString(6)', 'mysql/time-string@1', { precision: 6 }],
  ['Time(as: temporal)', 'TimeTemporal(6)', 'mysql/time-temporal@1', { precision: 6 }],
  ['Duration', 'DurationString', 'mysql/duration-string@1', undefined],
  ['DateTime?', 'DatetimeJsDate(3)?', 'mysql/datetime@1', { precision: 3 }],
];

describe('a MySQL convenience date and time type', () => {
  it.each(rows)('%s emits the contract %s emits', (convenience, explicit) => {
    expect(emitted(model(`at ${convenience}`))).toBe(emitted(model(`at ${explicit}`)));
  });

  it.each(rows)('%s is a column of %s', (convenience, _explicit, codecId, typeParams) => {
    const result = emit(model(`at ${convenience}`));
    expect(result.ok && result.value.storage.namespaces['__unbound__']).toMatchObject({
      entries: {
        table: {
          event: {
            columns: { at: { codecId, ...(typeParams === undefined ? {} : { typeParams }) } },
          },
        },
      },
    });
  });

  it('chooses the generator now() writes for the type it becomes, with its precision', () => {
    expect(
      emitted(
        model(
          'createdAt DateTime @onCreate(now())',
          'instant   DateTime(as: temporal) @onCreate(now()) @onUpdate(now())',
          'text      DateTime(as: string, storage: timestamp) @onCreate(now())',
          'day       Date @onCreate(now())',
          'clockT    Time(as: temporal, precision: 3) @onCreate(now())',
          'stamp     temporal.UpdatedAt',
        ),
      ),
    ).toBe(
      emitted(
        model(
          'createdAt DatetimeJsDate(3) @onCreate(now())',
          'instant   DatetimeTemporal(6) @onCreate(now()) @onUpdate(now())',
          'text      TimestampString(6) @onCreate(now())',
          'day       DateString @onCreate(now())',
          'clockT    TimeTemporal(3) @onCreate(now())',
          'stamp     DateTime @onCreate(now()) @onUpdate(now())',
        ),
      ),
    );
  });

  it('reads a default written with the tag of the type it becomes', () => {
    const result = emit(
      model(
        'day   Date @default(date`2024-02-29`)',
        'clock Time @default(time`09:30`)',
        'lasts Duration @default(duration`PT1H30M`)',
        'stamp DateTime(storage: timestamp) @default(timestamp`2024-01-01 10:00:00.500`)',
        'at    DateTime @default(datetime`2024-01-01T10:00:00`)',
      ),
    );
    expect(result.ok && result.value.storage.namespaces['__unbound__']).toMatchObject({
      entries: {
        table: {
          event: {
            columns: {
              day: { default: { kind: 'literal', value: '2024-02-29' } },
              clock: { default: { kind: 'literal', value: '09:30:00' } },
              lasts: { default: { kind: 'literal', value: 'PT1H30M' } },
              stamp: { default: { kind: 'literal', value: '2024-01-01T10:00:00.5' } },
              at: { default: { kind: 'literal', value: '2024-01-01T10:00:00' } },
            },
          },
        },
      },
    });
  });

  it.each([
    ['DateTime(precision: 0) @default(datetime`2024-01-01T00:00:00.5`)'],
    ['DatetimeJsDate @default(datetime`2024-01-01T00:00:00.5`)'],
    ['Time(precision: 2) @default(time`23:59:59.125`)'],
    ['Time(precision: 0) @default(time`23:59:59.6`)'],
  ])('refuses %s, a default MySQL would round to the column', (written) => {
    expect(failure(model(`at ${written}`))).toContain('holds without rounding');
  });

  it.each([
    ['Date(as: jsDate)', 'Argument \\"as\\" of Date is jsDate; write one of: string, temporal.'],
    [
      'DateTime(storage: timestamptz)',
      'Argument \\"storage\\" of DateTime is timestamptz; write one of: datetime, timestamp.',
    ],
    ['Duration(as: temporal)', 'Argument \\"as\\" of Duration is temporal; write one of: string.'],
  ])('refuses %s at the argument, naming the accepted choices', (written, message) => {
    expect(failure(model(`at ${written}`))).toContain(message);
  });

  it.each(['@onCreate(now())', '@onUpdate(now())'])(
    'refuses Duration %s, since a duration holds no current time',
    (attribute) => {
      expect(failure(model(`lasts Duration ${attribute}`))).toContain(
        'PSL_GENERATOR_NOT_APPLICABLE',
      );
    },
  );

  it.each([
    ['day Date @default(time`09:30`)', 'PSL_VALUE_TYPE_INCOMPATIBLE'],
    ['day Date @default(date`2024-02-30`)', '2024-02-30'],
    ['stamp DateTime(storage: timestamp) @default(timestamp`1969-12-31T00:00:00`)', '1969-12-31'],
  ])('refuses the default %s', (field, message) => {
    expect(failure(model(field))).toContain(message);
  });
});

describe('a MySQL convenience date and time type in the TypeScript builder', () => {
  it('chooses the codec and precision of the explicit type it becomes', () => {
    const contract = defineContract({}, ({ type, field, model }) => ({
      models: {
        Event: model('Event', {
          fields: {
            id: field.column(type.Int()).id(),
            at: field.column(type.DateTime()),
            exactAt: field.column(type.DateTime({ as: 'temporal', storage: 'timestamp' })),
            day: field.column(type.Date()),
            opensAt: field.column(type.Time({ as: 'temporal', precision: 3 })),
            lasts: field.column(type.Duration()),
          },
        }).sql({ table: 'event' }),
      },
    }));
    const columns = contract.storage.namespaces['__unbound__']?.entries.table?.['event']?.columns;
    expect({
      at: [columns?.['at']?.codecId, columns?.['at']?.typeParams],
      exactAt: [columns?.['exactAt']?.codecId, columns?.['exactAt']?.typeParams],
      day: [columns?.['day']?.codecId, 'typeParams' in Object(columns?.['day'])],
      opensAt: [columns?.['opensAt']?.codecId, columns?.['opensAt']?.typeParams],
      lasts: [columns?.['lasts']?.codecId, 'typeParams' in Object(columns?.['lasts'])],
    }).toEqual({
      at: ['mysql/datetime@1', { precision: 3 }],
      exactAt: ['mysql/timestamp-temporal@1', { precision: 6 }],
      day: ['mysql/date-string@1', false],
      opensAt: ['mysql/time-temporal@1', { precision: 3 }],
      lasts: ['mysql/duration-string@1', false],
    });
  });
});
