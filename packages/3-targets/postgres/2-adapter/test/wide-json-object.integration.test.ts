import postgresControlDriverDescriptor from '@internal/driver-postgres/control';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  AggregateExpr,
  CastExpr,
  FunctionCallExpr,
  JsonDocumentProjection,
  JsonObjectExpr,
  LiteralExpr,
  NativeJsonValueProjection,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { createContract, createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresAdapterCapabilities } from '../src/core/capabilities';
import { renderLoweredSql } from '../src/core/sql-renderer';
import type { PostgresContract } from '../src/core/types';

const contract: PostgresContract = {
  ...createContract<SqlStorage>({ target: 'postgres', targetFamily: 'sql' }),
  target: 'postgres',
};
const dataTypeLookup = createDataTypeLookup(postgresDataTypes);
const lower = (ast: SelectAst) =>
  renderLoweredSql(
    ast,
    contract,
    postgresCodecDescriptorRegistry,
    dataTypeLookup,
    postgresAdapterCapabilities,
  );
const entriesOf = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    JsonObjectExpr.entry(`field_${i}`, new NativeJsonValueProjection(LiteralExpr.of(i))),
  );
const textProjection = (object: JsonObjectExpr) =>
  ProjectionItem.of('doc', CastExpr.as(object, 'text'));

describe('wide JSON objects in PostgreSQL', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let driver: Awaited<ReturnType<typeof postgresControlDriverDescriptor.create>> | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    driver = await postgresControlDriverDescriptor.create(database.connectionString);
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await driver?.close();
    driver = undefined;
    await database?.close();
    database = undefined;
  }, timeouts.spinUpPpgDev);

  it.each([50, 51, 55, 101])('returns every field of a %i-entry object', async (count) => {
    const object = JsonObjectExpr.fromEntries(entriesOf(count));
    const { sql } = lower(SelectAst.noFrom().withProjection([textProjection(object)]));
    const { rows } = await driver!.query<{ doc: string }>(sql);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.doc)).toEqual(
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`field_${i}`, i])),
    );
  });

  it('preserves JSON null, duplicate keys, escaping and native JSON documents', async () => {
    const document = '{"duplicate":1,"duplicate":2,"huge":1e1000000,"escaped":"\\u0000"}';
    const entries = entriesOf(49);
    entries.push(
      JsonObjectExpr.entry('duplicate', new NativeJsonValueProjection(LiteralExpr.of('first'))),
      JsonObjectExpr.entry('duplicate', new NativeJsonValueProjection(LiteralExpr.of('second'))),
      JsonObjectExpr.entry('sql_null', new NativeJsonValueProjection(LiteralExpr.of(null))),
      JsonObjectExpr.entry(
        'json_null',
        new JsonDocumentProjection(CastExpr.as(LiteralExpr.of('null'), 'json')),
      ),
      JsonObjectExpr.entry(
        "quote'{}雪",
        new NativeJsonValueProjection(LiteralExpr.of('value "{}\\雪')),
      ),
      JsonObjectExpr.entry(
        'document',
        new JsonDocumentProjection(CastExpr.as(LiteralExpr.of(document), 'json')),
      ),
    );
    const object = JsonObjectExpr.fromEntries(entries);
    const { sql } = lower(
      SelectAst.noFrom().withProjection([
        textProjection(object),
        ProjectionItem.of('type', CastExpr.as(FunctionCallExpr.of('pg_typeof', [object]), 'text')),
      ]),
    );
    const { rows } = await driver!.query<{ doc: string; type: string }>(sql);
    const row = rows[0]!;
    expect(row.type).toBe('json');
    expect(row.doc).toContain('"duplicate" : "first", "duplicate" : "second"');
    expect(row.doc).toContain(document);
    expect(JSON.parse(row.doc)).toMatchObject({
      duplicate: 'second',
      sql_null: null,
      json_null: null,
      "quote'{}雪": 'value "{}\\雪',
    });
  });

  it('retains a wide nested document and ordered typed parameters', async () => {
    const values = Array.from({ length: 101 }, (_, i) => i + 1);
    const inner = JsonObjectExpr.fromEntries(
      values.map((value) =>
        JsonObjectExpr.entry(
          `field_${value}`,
          new NativeJsonValueProjection(
            CastExpr.as(ParamRef.of(value, { codec: { codecId: 'pg/int4@1' } }), 'int4'),
          ),
        ),
      ),
    );
    const outer = JsonObjectExpr.fromEntries([
      ...entriesOf(50),
      JsonObjectExpr.entry('nested', new JsonDocumentProjection(inner)),
    ]);
    const { sql, params } = lower(SelectAst.noFrom().withProjection([textProjection(outer)]));
    const bindings = params.map((parameter) => {
      if (parameter.kind !== 'literal') throw new Error('Unexpected prepared parameter');
      return parameter.value;
    });
    expect(bindings).toEqual(values);
    const { rows } = await driver!.query<{ doc: string }>(sql, bindings);
    expect(JSON.parse(rows[0]!.doc)).toEqual({
      ...Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`field_${i}`, i])),
      nested: Object.fromEntries(values.map((value) => [`field_${value}`, value])),
    });
  });

  it('evaluates every volatile entry exactly once in order', async () => {
    await driver!.query('CREATE SEQUENCE wide_json_evaluation_counter');
    const object = JsonObjectExpr.fromEntries(
      Array.from({ length: 55 }, (_, i) =>
        JsonObjectExpr.entry(
          `field_${i}`,
          new NativeJsonValueProjection(
            FunctionCallExpr.of('nextval', [LiteralExpr.of('wide_json_evaluation_counter')]),
          ),
        ),
      ),
    );
    const { sql } = lower(SelectAst.noFrom().withProjection([textProjection(object)]));
    const { rows } = await driver!.query<{ doc: string }>(sql);
    expect(JSON.parse(rows[0]!.doc)).toEqual(
      Object.fromEntries(Array.from({ length: 55 }, (_, i) => [`field_${i}`, i + 1])),
    );
    expect(
      (
        await driver!.query<{ value: string }>(
          'SELECT last_value::text AS value FROM wide_json_evaluation_counter',
        )
      ).rows,
    ).toEqual([{ value: '55' }]);
  });

  it('aggregates the original row set rather than a new scalar subquery', async () => {
    await driver!.query('CREATE TABLE wide_json_rows (value int4)');
    await driver!.query('INSERT INTO wide_json_rows VALUES (1), (2), (3)');
    const object = JsonObjectExpr.fromEntries([
      ...entriesOf(50),
      JsonObjectExpr.entry('count', new NativeJsonValueProjection(AggregateExpr.count())),
    ]);
    const { sql } = lower(
      SelectAst.from(TableSource.named('wide_json_rows')).withProjection([textProjection(object)]),
    );
    const expected = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`field_${i}`, i]));
    const first = (await driver!.query<{ doc: string }>(sql)).rows;
    expect(first).toHaveLength(1);
    expect(JSON.parse(first[0]!.doc)).toEqual({ ...expected, count: 3 });
    await driver!.query('TRUNCATE wide_json_rows');
    const empty = (await driver!.query<{ doc: string }>(sql)).rows;
    expect(empty).toHaveLength(1);
    expect(JSON.parse(empty[0]!.doc)).toEqual({ ...expected, count: 0 });
  });
});
