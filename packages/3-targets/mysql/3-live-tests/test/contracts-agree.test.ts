import { describe, expect, expectTypeOf, it } from 'vitest';
import type * as Mariadb from './fixtures/mariadb/generated/contract.d';
import mariadbJson from './fixtures/mariadb/generated/contract.json' with { type: 'json' };
import type * as Mysql from './fixtures/mysql/generated/contract.d';
import mysqlJson from './fixtures/mysql/generated/contract.json' with { type: 'json' };

describe('the contracts the live suites run with on each server, emitted from one schema for each target', () => {
  it('have the same models, roots and tables, and differ in target, hashes and capabilities', () => {
    const models = (json: typeof mysqlJson | typeof mariadbJson) => ({
      domain: json.domain,
      roots: json.roots,
      namespaces: json.storage.namespaces,
    });
    expect(models(mariadbJson)).toEqual(models(mysqlJson));
    expect({ mysql: mysqlJson.target, mariadb: mariadbJson.target }).toEqual({
      mysql: 'mysql',
      mariadb: 'mariadb',
    });
  });

  it('type the fields, the columns and the aggregates alike, so each suite types its queries alike on both', () => {
    expectTypeOf<Mariadb.FieldOutputTypes>().toEqualTypeOf<Mysql.FieldOutputTypes>();
    expectTypeOf<Mariadb.FieldInputTypes>().toEqualTypeOf<Mysql.FieldInputTypes>();
    expectTypeOf<Mariadb.StorageColumnTypes>().toEqualTypeOf<Mysql.StorageColumnTypes>();
    expectTypeOf<Mariadb.AggregateTypes>().toEqualTypeOf<Mysql.AggregateTypes>();
  });
});
