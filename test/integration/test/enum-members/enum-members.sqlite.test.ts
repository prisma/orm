import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { defineContract, enumType, member } from '@internal/sqlite/contract-builder';
import sqlite from '@internal/sqlite/runtime';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from './_fixture-sqlite/generated/contract';
import contractJson from './_fixture-sqlite/generated/contract.json' with { type: 'json' };

const launch = new Date('2024-01-01T00:00:00.000Z');
const sunset = new Date('2025-06-30T12:00:00.000Z');

const Level = enumType(
  'Level',
  { codecId: 'sqlite/bigint@1', nativeType: 'integer' },
  member('Low', 1n),
  member('High', 10n),
);
const When = enumType(
  'When',
  { codecId: 'sqlite/datetime@1', nativeType: 'text' },
  member('Launch', launch),
  member('Sunset', sunset),
);
const tsContract = defineContract({ enums: { Level, When } }, ({ field, model }) => ({
  models: {
    Sample: model('Sample', {
      fields: {
        id: field.column({ codecId: 'sqlite/integer@1', nativeType: 'integer' }).id(),
        level: field.namedType(Level),
        when: field.namedType(When),
      },
    }).sql({ table: 'samples' }),
  },
}));

let directory: string;
let path: string;
let database: DatabaseSync;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'enum-members-sqlite-'));
  path = join(directory, 'test.db');
  database = new DatabaseSync(path);
  database.exec(`
    create table readings (
      id integer primary key,
      text text not null,
      big integer not null,
      "when" text not null,
      real real not null
    );
    create table samples (
      id integer primary key,
      level integer not null,
      "when" text not null
    );
  `);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('db.enums on SQLite, against node:sqlite', () => {
  it('finds every value read from a PSL contract, and holds each member as the value read', async () => {
    const client = sqlite<Contract>({ contractJson, path, verifyMarker: false });
    try {
      await client.connect();
      const levels = client.enums;
      await client.orm.Reading.create({
        id: 1,
        text: levels.TextLevel.members.High,
        big: levels.BigLevel.members.High,
        when: levels.WhenLevel.members.Sunset,
        real: levels.RealLevel.members.Infinite,
      });
      const row = await client.orm.Reading.first();
      if (row === null) expect.unreachable('the row reads back');

      expect({
        has: [
          levels.TextLevel.has(row.text),
          levels.BigLevel.has(row.big),
          levels.WhenLevel.has(row.when),
          levels.RealLevel.has(row.real),
        ],
        equal: [
          levels.TextLevel.members.High === row.text,
          levels.BigLevel.members.High === row.big,
          levels.WhenLevel.members.Sunset.getTime() === row.when.getTime(),
          levels.RealLevel.members.Infinite === row.real,
        ],
      }).toEqual({ has: [true, true, true, true], equal: [true, true, true, true] });
    } finally {
      await client.close();
    }
  });

  it('finds every value read from a TypeScript contract', async () => {
    const client = sqlite({ contract: tsContract, path, verifyMarker: false });
    try {
      await client.connect();
      await client.orm.Sample.create({
        id: 1,
        level: client.enums.Level.members.High,
        when: client.enums.When.members.Sunset,
      });
      const row = await client.orm.Sample.first();
      if (row === null) expect.unreachable('the row reads back');
      expectTypeOf(row).toEqualTypeOf<{ id: number; level: 1n | 10n; when: Date }>();

      expect({
        has: [client.enums.Level.has(row.level), client.enums.When.has(row.when)],
        equal: [
          client.enums.Level.members.High === row.level,
          client.enums.When.members.Sunset.getTime() === row.when.getTime(),
        ],
      }).toEqual({ has: [true, true], equal: [true, true] });
    } finally {
      await client.close();
    }
  });

  it('types each member as the value a query returns for it', () => {
    const psl = sqlite<Contract>({ contractJson, path, verifyMarker: false }).enums;
    expectTypeOf(psl.TextLevel.members.Low).toEqualTypeOf<'low'>();
    expectTypeOf(psl.BigLevel.members.Low).toEqualTypeOf<1n>();
    expectTypeOf(psl.WhenLevel.members.Launch).toEqualTypeOf<Date>();
    expectTypeOf(psl.RealLevel.members.Infinite).toEqualTypeOf<number>();

    const ts = sqlite({ contract: tsContract, path, verifyMarker: false }).enums;
    expectTypeOf(ts.Level.members.Low).toEqualTypeOf<1n>();
    expectTypeOf(ts.When.members.Launch).toEqualTypeOf<Date>();
  });
});
