import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { orm } from '@internal/sql-orm-client';
import { activitySource, delegatingActivitySource } from '@internal/sql-runtime';
import type { SqliteClient } from '@internal/sqlite/runtime';
import sqlite from '@internal/sqlite/runtime';
import { contractFromJson } from '@internal/sqlite/static';
import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rejectionShape } from './error-shape';
import type { Contract } from './fixtures/boolean-sqlite/generated/contract';
import contractJson from './fixtures/boolean-sqlite/generated/contract.json' with { type: 'json' };

describe('integration/Boolean on sqlite', () => {
  let directory: string | undefined;
  let database: DatabaseSync | undefined;
  let client: SqliteClient<Contract> | undefined;
  let db: ReturnType<typeof orm<Contract>> | undefined;

  const accounts = () => db![UNBOUND_NAMESPACE_ID].Account;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-boolean-'));
    const path = join(directory, 'test.db');
    database = new DatabaseSync(path);
    database.exec(`
      create table account (
        id integer primary key,
        active integer not null default 1,
        admin integer
      );
      create table membership (
        id integer primary key,
        account_id integer not null references account(id),
        owner integer not null
      );
    `);

    client = sqlite({
      contract: contractFromJson<Contract>(contractJson),
      path,
      verifyMarker: false,
    });
    const runtime = await client.connect();
    db = orm({
      context: client.context,
      runtime: {
        query(plan) {
          return runtime.query(plan);
        },
        execute(plan) {
          return runtime.execute(plan);
        },
        connection() {
          return runtime.connection();
        },
        [activitySource]: delegatingActivitySource(() => runtime),
      },
    });
  });

  afterAll(async () => {
    await client?.close();
    database?.close();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  });

  it('emits sqlite/boolean@1 on the data type sqlite/boolean, with the default true', () => {
    const columns = contractJson.storage.namespaces.__unbound__.entries.table.account.columns;
    expect({ active: columns.active, admin: columns.admin }).toEqual({
      active: {
        codecId: 'sqlite/boolean@1',
        dataType: 'sqlite/boolean',
        default: { kind: 'literal', value: true },
        nullable: false,
      },
      admin: { codecId: 'sqlite/boolean@1', dataType: 'sqlite/boolean', nullable: true },
    });
  });

  it('writes true and false as 1 and 0 and reads them back as booleans', async () => {
    await accounts().create({ id: 1, active: true, admin: false });
    await accounts().create({ id: 2, active: false, admin: null });

    const rows = await accounts()
      .select('id', 'active', 'admin')
      .orderBy((account) => account.id.asc())
      .all();

    expect(rows).toEqual([
      { id: 1, active: true, admin: false },
      { id: 2, active: false, admin: null },
    ]);
    expect(
      database!
        .prepare('select active, typeof(active) as storage, admin from account order by id')
        .all(),
    ).toEqual([
      { active: 1, storage: 'integer', admin: 0 },
      { active: 0, storage: 'integer', admin: null },
    ]);
  });

  it('fills a field left out with the column default, read as true', async () => {
    await accounts().create({ id: 3 });
    const rows = await accounts()
      .select('id', 'active')
      .where((account) => account.id.eq(3))
      .all();
    expect(rows).toEqual([{ id: 3, active: true }]);
  });

  it('filters by equality', async () => {
    const active = await accounts()
      .select('id')
      .where((account) => account.active.eq(true))
      .orderBy((account) => account.id.asc())
      .all();
    const inactive = await accounts()
      .select('id')
      .where((account) => account.active.eq(false))
      .all();
    const notAdmin = await accounts()
      .select('id')
      .where((account) => account.admin.neq(true))
      .all();
    expect({ active, inactive, notAdmin }).toEqual({
      active: [{ id: 1 }, { id: 3 }],
      inactive: [{ id: 2 }],
      notAdmin: [{ id: 1 }],
    });
  });

  it('refuses to write a value that is not a boolean', async () => {
    const shape = await rejectionShape(
      accounts().create({ id: 4, active: 1 as unknown as boolean, admin: null }),
    );
    expect(shape).toEqual({
      name: 'StructuredError',
      message: 'sqlite/boolean@1 value must be a boolean, got 1',
      code: 'RUNTIME.ENCODE_FAILED',
      meta: { codecId: 'sqlite/boolean@1', received: '1' },
    });
  });

  it.each([
    ['2', '2'],
    ["'yes'", '"yes"'],
  ])('raises a decode error naming the column for the stored value %s', async (stored, shown) => {
    database!.exec(`insert into account (id, active) values (10, ${stored})`);

    const shape = await rejectionShape(
      accounts()
        .select('id', 'active')
        .where((account) => account.id.eq(10))
        .all(),
    );
    expect(shape).toEqual({
      name: 'StructuredError',
      message: `Column "account"."active" holds ${shown}, which is not 0 or 1. sqlite/boolean@1 reads 0 as false and 1 as true.`,
      code: 'RUNTIME.DECODE_FAILED',
      meta: {
        codecId: 'sqlite/boolean@1',
        table: 'account',
        column: 'active',
        received: stored.replaceAll("'", ''),
      },
    });

    database!.exec('delete from account where id = 10');
  });

  it('carries a Boolean column through an include, and names the column of a stored value that is not 0 or 1', async () => {
    await accounts().create({ id: 20, active: true, admin: null });
    await db![UNBOUND_NAMESPACE_ID].Membership.create({ id: 1, accountId: 20, owner: true });
    await db![UNBOUND_NAMESPACE_ID].Membership.create({ id: 2, accountId: 20, owner: false });
    const included = () =>
      accounts()
        .select('id')
        .where((account) => account.id.eq(20))
        .include('memberships', (membership) =>
          membership.select('id', 'owner').orderBy((m) => m.id.asc()),
        )
        .all();

    const read = await included();
    database!.exec('insert into membership (id, account_id, owner) values (3, 20, 2)');
    const refused = await rejectionShape(included());

    expect({ read, refused }).toEqual({
      read: [
        {
          id: 20,
          memberships: [
            { id: 1, owner: true },
            { id: 2, owner: false },
          ],
        },
      ],
      refused: {
        name: 'RuntimeError',
        message:
          'Failed to decode column membership.owner with codec \'sqlite/boolean@1\': Column "membership"."owner" holds 2, which is not 0 or 1. sqlite/boolean@1 reads 0 as false and 1 as true.',
        code: 'RUNTIME.DECODE_FAILED',
        category: 'RUNTIME',
        severity: 'error',
        details: { table: 'membership', column: 'owner', codec: 'sqlite/boolean@1' },
        cause: {
          name: 'StructuredError',
          message:
            'Column "membership"."owner" holds 2, which is not 0 or 1. sqlite/boolean@1 reads 0 as false and 1 as true.',
          code: 'RUNTIME.DECODE_FAILED',
          meta: {
            codecId: 'sqlite/boolean@1',
            table: 'membership',
            column: 'owner',
            received: '2',
          },
        },
      },
    });
  });
});
