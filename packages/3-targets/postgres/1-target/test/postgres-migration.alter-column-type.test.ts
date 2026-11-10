/**
 * `this.alterColumnType` reads the migration's start contract, after the renames made earlier in the same migration: it refuses a `using` conversion to the type the column already has there, and it changes the sequence an `autoincrement()` column owns to the new width.
 */
import { describe, expect, it } from 'vitest';
import { PostgresMigration } from '../src/core/migrations/postgres-migration';
import {
  boxContract,
  codecControlStack,
  exposedMigration,
  type Op,
  serializedContract,
} from './fixtures/start-contract-migration';

function alterChangedColumnAfterTableRename(type: string): Promise<Op>[] {
  const startJson = serializedContract(boxContract(undefined));
  const endJson = serializedContract(
    boxContract(undefined, 'public', { table: 'Crate', column: 'changed' }),
  );
  class RenameThenAlterColumnType extends PostgresMigration {
    override readonly startContractJson = startJson;
    override readonly endContractJson = endJson;
    override get operations(): readonly Promise<Op>[] {
      return [
        ...this.renameTable({ table: 'Box', to: 'Crate' }),
        this.alterColumnType({
          schema: 'public',
          table: 'Crate',
          column: 'changed',
          type,
          using: '"changed" * 2',
        }),
      ];
    }
  }
  return [...new RenameThenAlterColumnType(codecControlStack()).operations];
}

const USING_WITHOUT_TYPE_CHANGE = expect.objectContaining({
  code: 'MIGRATION.ALTER_COLUMN_TYPE_USING_WITHOUT_TYPE_CHANGE',
  meta: expect.objectContaining({ type: 'int4' }),
});

const USING_WITHOUT_TYPE_CHANGE_TO = (type: string) =>
  expect.objectContaining({
    code: 'MIGRATION.ALTER_COLUMN_TYPE_USING_WITHOUT_TYPE_CHANGE',
    meta: expect.objectContaining({ type }),
  });

describe('this.alterColumnType and the start contract', () => {
  it('refuses a using conversion to the type the start contract already gives the column', () => {
    expect(() =>
      exposedMigration(boxContract(undefined)).callAlterColumnType({
        schema: 'public',
        table: 'Box',
        column: 'changed',
        type: 'int4',
        using: '"changed" * 2',
      }),
    ).toThrow(USING_WITHOUT_TYPE_CHANGE);
  });

  it('says the type is the one the start contract gives, after earlier renames', () => {
    expect(() =>
      exposedMigration(boxContract(undefined)).callAlterColumnType({
        schema: 'public',
        table: 'Box',
        column: 'changed',
        type: 'int4',
        using: '"changed" * 2',
      }),
    ).toThrow(
      'alterColumnType({ schema: "public", table: "Box", column: "changed" }): the start contract, after the earlier renames in this migration, already gives the column the type "int4", so the conversion in using would never run',
    );
  });

  it('refuses an unchanged type with using on a table an earlier renameTable renamed', () => {
    expect(() => alterChangedColumnAfterTableRename('int4')).toThrow(USING_WITHOUT_TYPE_CHANGE);
  });

  it('refuses a using conversion to the start type written another way', () => {
    const refused = (type: string) => () =>
      exposedMigration(boxContract(undefined)).callAlterColumnType({
        schema: 'public',
        table: 'Box',
        column: 'changed',
        type,
        using: '"changed" * 2',
      });
    expect(refused('integer')).toThrow(USING_WITHOUT_TYPE_CHANGE_TO('integer'));
    expect(refused('INT')).toThrow(USING_WITHOUT_TYPE_CHANGE_TO('INT'));
  });

  it('refuses a using conversion to the enum outside public the start contract gives the column', () => {
    const status = {
      dataType: 'pg/enum',
      codecId: 'pg/enum@1',
      nullable: false,
      typeParams: { typeName: 'app.status' },
    };
    expect(() =>
      exposedMigration(
        boxContract(undefined, 'public', { table: 'Box', column: 'changed' }, status),
      ).callAlterColumnType({
        schema: 'public',
        table: 'Box',
        column: 'changed',
        type: '"app"."status"',
        using: '"changed"::text::"app"."status"',
      }),
    ).toThrow(USING_WITHOUT_TYPE_CHANGE_TO('"app"."status"'));
  });

  it('accepts a using conversion to another type', async () => {
    const ops = await Promise.all(alterChangedColumnAfterTableRename('int8'));

    expect(ops.at(-1)?.operationClass).toBe('data');
  });

  it('accepts an unchanged type without using', async () => {
    const op = await exposedMigration(boxContract(undefined)).callAlterColumnType({
      schema: 'public',
      table: 'Box',
      column: 'changed',
      type: 'int4',
    });

    expect(op.operationClass).toBe('destructive');
  });

  it('changes the sequence an autoincrement() start column owns to the new width, found by pg_get_serial_sequence', async () => {
    const op = await exposedMigration(
      boxContract({ kind: 'function', expression: 'autoincrement()' }),
    ).callAlterColumnType({ schema: 'public', table: 'Box', column: 'changed', type: 'int8' });

    expect({
      precheck: op.precheck.map((step) => step.description),
      execute: op.execute.map((step) => step.description),
      postcheck: op.postcheck.map((step) => step.description),
      alterSequence: op.execute[1]?.sql,
    }).toEqual({
      precheck: [
        'ensure column "changed" exists',
        'ensure the sequence column "changed" owns has no value past the bigint range',
      ],
      execute: [
        'alter type of "changed" to int8',
        'change the sequence column "changed" owns, if any, to bigint',
      ],
      postcheck: [
        'verify column "changed" has type "bigint"',
        'verify the sequence column "changed" owns, if any, is of type bigint',
      ],
      alterSequence: `DO $prisma$ BEGIN IF pg_get_serial_sequence('"public"."Box"', 'changed')::regclass IS NOT NULL THEN EXECUTE format('ALTER SEQUENCE %s AS bigint', pg_get_serial_sequence('"public"."Box"', 'changed')::regclass); END IF; END $prisma$`,
    });
  });
});
