import postgresControlDriverDescriptor from '@internal/driver-postgres/control';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  type AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  InsertAst,
  InsertOnConflict,
  ParamRef,
  ProjectionItem,
  TableSource,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { createContract, createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postgresAdapterCapabilities } from '../src/core/capabilities';
import { renderLoweredSql } from '../src/core/sql-renderer';
import type { PostgresContract } from '../src/core/types';

const contract: PostgresContract = {
  ...createContract<SqlStorage>({ target: 'postgres', targetFamily: 'sql' }),
  target: 'postgres',
};

const item = TableSource.named('item', 'i');
const column = (name: string) => ColumnRef.of('i', name);
const int = (value: number) => ParamRef.of(value, { codec: { codecId: 'pg/int4@1' } });
const text = (value: string) => ParamRef.of(value, { codec: { codecId: 'pg/text@1' } });
const returning = (...names: string[]) =>
  names.map((name) => ProjectionItem.of(name, column(name)));

function insertOne(id: number, name: string, n: number): InsertAst {
  return InsertAst.into(item).withRows([{ id: int(id), name: text(name), n: int(n) }]);
}

describe('write statements on an aliased target, run against Postgres', {
  concurrent: false,
}, () => {
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

  beforeEach(async () => {
    await driver!.query('DROP TABLE IF EXISTS item');
    await driver!.query('CREATE TABLE item (id int PRIMARY KEY, name text UNIQUE, n int)');
  });

  async function run(ast: AnyQueryAst): Promise<unknown[]> {
    const { sql, params } = renderLoweredSql(
      ast,
      contract,
      postgresCodecDescriptorRegistry,
      createDataTypeLookup(postgresDataTypes),
      postgresAdapterCapabilities,
    );
    const values = params.map((param) => (param.kind === 'literal' ? param.value : null));
    return (await driver!.query(sql, values)).rows;
  }

  async function rows(): Promise<unknown[]> {
    return (await driver!.query('SELECT id, name, n FROM item ORDER BY id')).rows;
  }

  it('inserts and returns its columns', { timeout: timeouts.spinUpPpgDev }, async () => {
    expect(await run(insertOne(1, 'a', 1).withReturning(returning('id', 'name')))).toEqual([
      { id: 1, name: 'a' },
    ]);
    expect(await rows()).toEqual([{ id: 1, name: 'a', n: 1 }]);
  });

  it('updates the conflicting row from excluded and returns it', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await run(insertOne(1, 'a', 1));

    const upsert = insertOne(2, 'a', 5)
      .withOnConflict(
        InsertOnConflict.on([column('name')]).doUpdateSet({ n: ColumnRef.of('excluded', 'n') }),
      )
      .withReturning(returning('id', 'n'));

    expect(await run(upsert)).toEqual([{ id: 1, n: 5 }]);
    expect(await rows()).toEqual([{ id: 1, name: 'a', n: 5 }]);
  });

  it('updates the rows its condition on the alias matches and returns them', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await run(insertOne(1, 'a', 1));
    await run(insertOne(2, 'b', 2));

    const update = UpdateAst.table(item)
      .withSet({ n: int(9) })
      .withWhere(BinaryExpr.eq(column('id'), int(2)))
      .withReturning(returning('id', 'n'));

    expect(await run(update)).toEqual([{ id: 2, n: 9 }]);
    expect(await rows()).toEqual([
      { id: 1, name: 'a', n: 1 },
      { id: 2, name: 'b', n: 9 },
    ]);
  });

  it('deletes the rows its condition on the alias matches and returns them', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await run(insertOne(1, 'a', 1));
    await run(insertOne(2, 'b', 2));

    const del = DeleteAst.from(item)
      .withWhere(BinaryExpr.eq(column('id'), int(1)))
      .withReturning(returning('id'));

    expect(await run(del)).toEqual([{ id: 1 }]);
    expect(await rows()).toEqual([{ id: 2, name: 'b', n: 2 }]);
  });
});
