import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineContract, enumType, member } from '../src/exports/contract-builder';
import sqliteStatic from '../src/static/sqlite-static';

const launch = '2024-01-01T00:00:00.000Z';
const sunset = '2025-06-30T12:00:00.000Z';

const Level = enumType(
  'Level',
  { codecId: 'sqlite/bigint@1', nativeType: 'integer' },
  member('Low', 1n),
  member('High', 10n),
);
const When = enumType(
  'When',
  { codecId: 'sqlite/datetime@1', nativeType: 'text' },
  member('Launch', new Date(launch)),
  member('Sunset', new Date(sunset)),
);

const contract = defineContract({ enums: { Level, When } }, ({ field, model }) => ({
  models: {
    Reading: model('Reading', {
      fields: {
        id: field.id.uuidv4String(),
        level: field.namedType(Level),
        when: field.namedType(When),
      },
    }),
  },
}));

const { enums } = sqliteStatic<typeof contract>({ contractJson: contract });

describe('db.enums on SQLite', () => {
  it('holds each member as its codec reads it and finds an equal value', () => {
    expect({
      level: enums.Level.members,
      when: enums.When.members,
      found: [enums.Level.has(10n), enums.When.nameOf(new Date(sunset))],
    }).toEqual({
      level: { Low: 1n, High: 10n },
      when: { Launch: new Date(launch), Sunset: new Date(sunset) },
      found: [true, 'Sunset'],
    });
  });

  it('types each member as the value it holds', () => {
    expectTypeOf(enums.Level.members.Low).toEqualTypeOf<1n>();
    expectTypeOf(enums.When.members.Launch).toEqualTypeOf<Date>();
    expectTypeOf(enums.Level.values).toEqualTypeOf<readonly [1n, 10n]>();
  });
});
