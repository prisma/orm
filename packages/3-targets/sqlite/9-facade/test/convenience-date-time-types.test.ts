import sqliteAdapter from '@internal/adapter-sqlite/control';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import sqlite from '@internal/target-sqlite/control';
import sqlitePackRef from '@internal/target-sqlite/pack';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';

const stack = createControlStack({
  family: sql,
  target: sqlite,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
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
      target: sqlitePackRef,
      createNamespace: sqliteCreateNamespace,
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

const rows: readonly (readonly [convenience: string, explicit: string, codecId: string])[] = [
  ['DateTime', 'DatetimeJsDate', 'sqlite/datetime@1'],
  ['DateTime(as: jsDate, storage: text)', 'DatetimeJsDate', 'sqlite/datetime@1'],
  ['DateTime(as: temporal)', 'DatetimeTemporal', 'sqlite/datetime-temporal@1'],
  ['DateTime(as: string)', 'DatetimeString', 'sqlite/datetime-string@1'],
  ['Date', 'DateString', 'sqlite/date-string@1'],
  ['Date(as: temporal)', 'DateTemporal', 'sqlite/date-temporal@1'],
  ['Time', 'TimeString', 'sqlite/time-string@1'],
  ['Time(as: temporal)', 'TimeTemporal', 'sqlite/time-temporal@1'],
  ['Duration', 'DurationString', 'sqlite/duration-string@1'],
  ['DateTime?', 'DatetimeJsDate?', 'sqlite/datetime@1'],
];

describe('a SQLite convenience date and time type', () => {
  it.each(rows)('%s emits the contract %s emits', (convenience, explicit) => {
    expect(emitted(model(`at ${convenience}`))).toBe(emitted(model(`at ${explicit}`)));
  });

  it.each(rows)('%s is a column of %s, stored as text', (convenience, _explicit, codecId) => {
    const result = emit(model(`at ${convenience}`));
    expect(result.ok && result.value.storage.namespaces['__unbound__']).toMatchObject({
      entries: { table: { event: { columns: { at: { codecId } } } } },
    });
  });

  it('chooses the generator now() writes for the type it becomes', () => {
    expect(
      emitted(
        model(
          'createdAt DateTime @onCreate(now())',
          'instant   DateTime(as: temporal) @onCreate(now()) @onUpdate(now())',
          'text      DateTime(as: string) @onCreate(now())',
          'day       Date @onCreate(now())',
          'dayT      Date(as: temporal) @onCreate(now())',
          'clock     Time @onCreate(now())',
          'clockT    Time(as: temporal) @onCreate(now())',
        ),
      ),
    ).toBe(
      emitted(
        model(
          'createdAt DatetimeJsDate @onCreate(now())',
          'instant   DatetimeTemporal @onCreate(now()) @onUpdate(now())',
          'text      DatetimeString @onCreate(now())',
          'day       DateString @onCreate(now())',
          'dayT      DateTemporal @onCreate(now())',
          'clock     TimeString @onCreate(now())',
          'clockT    TimeTemporal @onCreate(now())',
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
        'at    DateTime(as: string) @default(datetime`2024-01-01T05:30:00+05:30`)',
      ),
    );
    expect(result.ok && result.value.storage.namespaces['__unbound__']).toMatchObject({
      entries: {
        table: {
          event: {
            columns: {
              day: { default: { kind: 'literal', value: '2024-02-29' } },
              clock: { default: { kind: 'literal', value: '09:30:00.000' } },
              lasts: { default: { kind: 'literal', value: 'PT1H30M' } },
              at: { default: { kind: 'literal', value: '2024-01-01T00:00:00.000Z' } },
            },
          },
        },
      },
    });
  });

  it.each([
    ['Date(as: jsDate)', 'Argument \\"as\\" of Date is jsDate; write one of: string, temporal.'],
    [
      'DateTime(storage: timestamptz)',
      'Argument \\"storage\\" of DateTime is timestamptz; write one of: text.',
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

  it('refuses a default of another date and time type', () => {
    expect(failure(model('day Date @default(time`09:30`)'))).toContain(
      'PSL_VALUE_TYPE_INCOMPATIBLE',
    );
  });
});

describe('a SQLite convenience date and time type in the TypeScript builder', () => {
  it('chooses the codec of the explicit type it becomes', () => {
    const contract = defineContract({}, ({ type, field, model }) => ({
      models: {
        Event: model('Event', {
          fields: {
            id: field.column(type.Int()).id(),
            at: field.column(type.DateTime()),
            exactAt: field.column(type.DateTime({ as: 'temporal' })),
            day: field.column(type.Date()),
            opensAt: field.column(type.Time({ as: 'temporal' })),
            lasts: field.column(type.Duration()),
          },
        }).sql({ table: 'event' }),
      },
    }));
    const columns = contract.storage.namespaces['__unbound__']?.entries.table?.['event']?.columns;
    expect({
      at: columns?.['at']?.codecId,
      exactAt: columns?.['exactAt']?.codecId,
      day: columns?.['day']?.codecId,
      opensAt: columns?.['opensAt']?.codecId,
      lasts: columns?.['lasts']?.codecId,
    }).toEqual({
      at: 'sqlite/datetime@1',
      exactAt: 'sqlite/datetime-temporal@1',
      day: 'sqlite/date-string@1',
      opensAt: 'sqlite/time-temporal@1',
      lasts: 'sqlite/duration-string@1',
    });
  });
});
