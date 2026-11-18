/**
 * The postcheck after `ALTER COLUMN … TYPE` recognises every Postgres data type a column can be changed to, as a column and as a list: by the text `format_type` prints, and an enum by its identity, whatever schema it is in. Run before the change, it fails.
 */
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  isSqlDataType,
  renderSqlTypeName,
  type SqlDataType,
  type SqlTypeParams,
  sqlDataType,
} from '@internal/sql-contract/data-type';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { AlterColumnTypeCall } from '@internal/target-postgres/op-factory-call';
import { type as arktype } from 'arktype';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

function accepts(type: SqlDataType, params: SqlTypeParams): boolean {
  return type.params === undefined || !(type.params(params) instanceof arktype.errors);
}

/** Each written text of `type` with parameters its schema accepts. */
function writtenTexts(type: SqlDataType): readonly string[] {
  return type.sql.texts
    .filter((text) => text.written === true)
    .flatMap((text) => {
      const params: Record<string, number> = {};
      for (const match of text.text.matchAll(PLACEHOLDER)) {
        const name = match[1] ?? '';
        const value = [3, 1, 2, 10].find((candidate) =>
          accepts(type, { ...params, [name]: candidate }),
        );
        if (value === undefined) return [];
        params[name] = value;
      }
      return accepts(type, params) ? [renderSqlTypeName(type, params)] : [];
    });
}

const written = postgresDataTypes
  .filter(isSqlDataType)
  .filter((type) => type.sql.claimsKind === undefined)
  .flatMap((type) => writtenTexts(type).map((text) => ({ id: type.id, text })));

describe('the ALTER COLUMN TYPE postcheck', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) await database.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
    await driver.query('DROP SCHEMA IF EXISTS app CASCADE');
    await driver.query('CREATE SCHEMA app');
    await driver.query(`CREATE TYPE "Mood" AS ENUM ('happy', 'sad')`);
    await driver.query(`CREATE TYPE app.status AS ENUM ('on', 'off')`);
    await driver.query(`CREATE TYPE "Order Status" AS ENUM ('open', 'closed')`);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  /** Changes a column of `from` to `type`, returning whether the postcheck held before and after the change. */
  async function changeColumn(from: string, type: string, dataTypes = postgresDataTypes) {
    await driver!.query('DROP TABLE IF EXISTS "t"');
    await driver!.query(`CREATE TABLE "t" (id int4 PRIMARY KEY, c ${from})`);
    const op = await new AlterColumnTypeCall({
      ownsAutoincrementSequence: false,
      schemaName: UNBOUND_NAMESPACE_ID,
      tableName: 't',
      columnName: 'c',
      type,
      using: { kind: 'sql', sql: 'NULL' },
      dataTypes,
    }).toOp(controlAdapter);
    const postcheck = async () => {
      const results = await Promise.all(
        op.postcheck.map((step) => driver!.query<{ result: boolean }>(step.sql, step.params ?? [])),
      );
      return results.every((result) => result.rows[0]?.result === true);
    };
    const before = await postcheck();
    for (const step of op.execute) await driver!.query(step.sql);
    return { before, after: await postcheck() };
  }

  it('recognises every written type of every Postgres data type, as a column and a list', {
    timeout: testTimeout * 4,
  }, async () => {
    const failures: unknown[] = [];
    for (const { id, text } of written) {
      const from = id === 'pg/int4' ? 'text' : 'int4';
      for (const [source, target] of [
        [from, text],
        [`${from}[]`, `${text}[]`],
      ] as const) {
        const result = await changeColumn(source, target);
        if (result.before || !result.after) failures.push({ id, source, target, ...result });
      }
    }
    expect(failures).toEqual([]);
    expect(written.length).toBeGreaterThan(30);
  });

  it('recognises an enum by identity, in public, in another schema, with a quoted name, and as a list', {
    timeout: testTimeout,
  }, async () => {
    const results = [];
    for (const type of [
      '"Mood"',
      '"public"."Mood"',
      '"app"."status"',
      '"Order Status"',
      '"Mood"[]',
      '"app"."status"[]',
    ]) {
      results.push({
        type,
        ...(await changeColumn(type.endsWith('[]') ? 'text[]' : 'text', type)),
      });
    }
    expect(results.filter(({ before, after }) => before || !after)).toEqual([]);
  });

  it('recognises a type a pack declares, by the catalog text its data type declares', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE EXTENSION IF NOT EXISTS vector');
    const vector = sqlDataType('testpack/vector', {
      read: (json) => json,
      params: arktype({ length: 'number.integer >= 1' }),
      texts: [{ text: 'vector({length})', written: true, catalog: true }],
    });
    const dataTypes = [...postgresDataTypes, vector];
    expect({
      fromInt: await changeColumn('int4', 'vector(3)', dataTypes),
      length: await changeColumn('vector(2)', 'vector(3)', dataTypes),
      list: await changeColumn('int4[]', 'vector(3)[]', dataTypes),
    }).toEqual({
      fromInt: { before: false, after: true },
      length: { before: false, after: true },
      list: { before: false, after: true },
    });
  });

  it('recognises an enum in another schema while that schema is on the search path', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('SET search_path TO public, app');
    expect(await changeColumn('text', '"app"."status"')).toEqual({ before: false, after: true });
  });

  it('fails for an enum column whose type is another enum of the same name in another schema', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(`CREATE TYPE app."Mood" AS ENUM ('x')`);
    await driver!.query('DROP TABLE IF EXISTS "t"');
    await driver!.query(`CREATE TABLE "t" (id int4 PRIMARY KEY, c app."Mood")`);
    const op = await new AlterColumnTypeCall({
      ownsAutoincrementSequence: false,
      schemaName: UNBOUND_NAMESPACE_ID,
      tableName: 't',
      columnName: 'c',
      type: '"Mood"',
      dataTypes: postgresDataTypes,
    }).toOp(controlAdapter);
    const [postcheck] = op.postcheck;
    const checked = await driver!.query<{ result: boolean }>(
      postcheck?.sql ?? '',
      postcheck?.params ?? [],
    );
    expect(checked.rows).toEqual([{ result: false }]);
  });
});
