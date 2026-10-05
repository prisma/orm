import { enumType, member } from '@internal/sql-contract-ts/contract-builder';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';
import sqliteStatic from '../src/static/sqlite-static';

const Level = enumType(
  'Level',
  { codecId: 'sqlite/bigint@1', nativeType: 'integer' },
  member('Low', 1n),
  member('High', 10n),
);

const contract = defineContract({ enums: { Level } }, ({ field, model }) => ({
  models: {
    Reading: model('Reading', {
      fields: { id: field.id.uuidv4String(), level: field.namedType(Level) },
    }),
  },
}));

describe('db.enums on SQLite', () => {
  it('holds each member as its codec reads it and finds an equal value', () => {
    const { enums } = sqliteStatic<typeof contract>({ contractJson: contract });
    const level = enums['Level'] ?? expect.unreachable('the contract declares Level');
    const isMember = (value: unknown) => level.has(value);
    expect({
      members: level.members,
      found: isMember(10n),
      stored: isMember('10'),
    }).toEqual({ members: { Low: 1n, High: 10n }, found: true, stored: false });
  });
});
