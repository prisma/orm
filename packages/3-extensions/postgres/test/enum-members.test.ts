import 'temporal-polyfill/full/global';
import { describe, expect, it } from 'vitest';
import { defineContract, enumType, member } from '../src/exports/contract-builder';
import postgresStatic from '../src/static/postgres-static';

const uuidA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const uuidB = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';
const launch = '2024-01-01T00:00:00.000Z';
const sunset = '2025-06-30T12:00:00.000Z';

const TextLevel = enumType(
  'TextLevel',
  { codecId: 'pg/text@1', nativeType: 'text' },
  member('Low', 'low'),
  member('High', 'high'),
);
const Int4Level = enumType(
  'Int4Level',
  { codecId: 'pg/int4@1', nativeType: 'int4' },
  member('Low', 1),
  member('High', 10),
);
const Int8Level = enumType(
  'Int8Level',
  { codecId: 'pg/int8@1', nativeType: 'int8' },
  member('Low', 1n),
  member('High', 10n),
);
const UuidLevel = enumType(
  'UuidLevel',
  { codecId: 'pg/uuid@1', nativeType: 'uuid' },
  member('First', uuidA),
  member('Second', uuidB),
);
const DateLevel = enumType(
  'DateLevel',
  { codecId: 'pg/timestamptz-date@1', nativeType: 'timestamptz' },
  member('Launch', new Date(launch)),
  member('Sunset', new Date(sunset)),
);
const DayLevel = enumType(
  'DayLevel',
  { codecId: 'pg/date-temporal@1', nativeType: 'date' },
  member('Launch', Temporal.PlainDate.from('2024-01-01')),
  member('Sunset', Temporal.PlainDate.from('2025-06-30')),
);
const InstantLevel = enumType(
  'InstantLevel',
  { codecId: 'pg/timestamptz-temporal@1', nativeType: 'timestamptz' },
  member('Launch', Temporal.Instant.from(launch)),
  member('Sunset', Temporal.Instant.from(sunset)),
);
const Float8Level = enumType(
  'Float8Level',
  { codecId: 'pg/float8@1', nativeType: 'float8' },
  member('Half', 1.5),
  member('Whole', 2.25),
);

const contract = defineContract(
  {
    enums: {
      TextLevel,
      Int4Level,
      Int8Level,
      UuidLevel,
      DateLevel,
      DayLevel,
      InstantLevel,
      Float8Level,
    },
  },
  ({ field, model }) => ({
    models: {
      Reading: model('Reading', {
        fields: {
          id: field.id.uuidv4String(),
          text: field.namedType(TextLevel),
          int4: field.namedType(Int4Level),
          int8: field.namedType(Int8Level),
          uuid: field.namedType(UuidLevel),
          date: field.namedType(DateLevel),
          day: field.namedType(DayLevel),
          instant: field.namedType(InstantLevel),
          float8: field.namedType(Float8Level),
        },
      }),
    },
  }),
);

const { enums } = postgresStatic<typeof contract>({ contractJson: contract });
const levels = enums['public'] ?? expect.unreachable('the TS builder registers enums in public');

const isMember = (accessor: { has(value: unknown): boolean }, value: unknown) =>
  accessor.has(value);

describe('db.enums members hold the value a query returns for them', () => {
  it('holds text, int4, uuid and float8 members as they are stored', () => {
    expect({
      text: levels.TextLevel.members,
      int4: levels.Int4Level.members,
      uuid: levels.UuidLevel.members,
      float8: levels.Float8Level.members,
    }).toEqual({
      text: { Low: 'low', High: 'high' },
      int4: { Low: 1, High: 10 },
      uuid: { First: uuidA, Second: uuidB },
      float8: { Half: 1.5, Whole: 2.25 },
    });
  });

  it('holds int8 members as bigints', () => {
    expect({ members: levels.Int8Level.members, values: levels.Int8Level.values }).toEqual({
      members: { Low: 1n, High: 10n },
      values: [1n, 10n],
    });
  });

  it('holds timestamptz-date members as dates', () => {
    expect(levels.DateLevel.members).toEqual({
      Launch: new Date(launch),
      Sunset: new Date(sunset),
    });
  });

  it('holds Temporal members as Temporal values', () => {
    const { DayLevel: day, InstantLevel: instant } = levels;
    expect({
      day: day.values.map((value) => value instanceof Temporal.PlainDate && value.toString()),
      instant: instant.values.map((value) => value instanceof Temporal.Instant && value.toString()),
    }).toEqual({
      day: ['2024-01-01', '2025-06-30'],
      instant: ['2024-01-01T00:00:00Z', '2025-06-30T12:00:00Z'],
    });
  });
});

describe('db.enums finds values equal to a member', () => {
  it('finds a value equal to each member, and no stored form that differs from the value', () => {
    expect({
      text: levels.TextLevel.has('high'),
      int4: levels.Int4Level.has(10),
      int8: levels.Int8Level.has(10n),
      int8Stored: isMember(levels.Int8Level, '10'),
      int8Number: isMember(levels.Int8Level, 10),
      uuid: levels.UuidLevel.has(uuidB),
      float8: levels.Float8Level.has(2.25),
    }).toEqual({
      text: true,
      int4: true,
      int8: true,
      int8Stored: false,
      int8Number: false,
      uuid: true,
      float8: true,
    });
  });

  it('finds a date or Temporal value equal to a member, not only the member itself', () => {
    expect({
      date: levels.DateLevel.nameOf(new Date(sunset)),
      dateStored: isMember(levels.DateLevel, sunset),
      day: levels.DayLevel.ordinalOf(Temporal.PlainDate.from('2025-06-30')),
      dayStored: isMember(levels.DayLevel, '2025-06-30'),
      instant: levels.InstantLevel.nameOf(Temporal.Instant.from(launch)),
      instantOther: levels.InstantLevel.has(Temporal.Instant.from('2024-01-02T00:00:00Z')),
    }).toEqual({
      date: 'Sunset',
      dateStored: false,
      day: 1,
      dayStored: false,
      instant: 'Launch',
      instantOther: false,
    });
  });
});
