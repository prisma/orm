import mysqlDriver from '@internal/driver-mysql/runtime';
import { blindCast } from '@internal/utils/casts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql from '../../src/exports/runtime';
import mysqlStatic, { contractFromJson } from '../../src/exports/static';
import type { Contract } from '../fixtures/generated/contract.d';
import contractJson from '../fixtures/generated/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);

let driverCreate: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  driverCreate = vi.spyOn(mysqlDriver, 'create');
});

afterEach(() => {
  driverCreate.mockRestore();
});

describe('a MySQL client with no database', () => {
  it('renders the SQL builder and ORM plans as MySQL, without a driver', () => {
    const db = mysql({ contract });
    expect({
      builder: db.toSql(
        db.sql.User.select('id', 'email')
          .where((f, fns) => fns.eq(f.role, 'ADMIN'))
          .limit(10)
          .build(),
      ),
      orm: db.toSql(
        db.orm.User.select('id')
          .include('posts', (posts) => posts.select('title').orderBy((p) => p.title.desc()))
          .where({ role: 'ADMIN' })
          .prepared.all().plan,
      ),
      driverCreated: driverCreate.mock.calls.length,
    }).toEqual({
      builder: {
        sql: 'SELECT `id` AS `id`, `email` AS `email` FROM `User` WHERE `role` = ?1 LIMIT 10',
        params: ['ADMIN'],
      },
      orm: {
        sql: "SELECT /*+ SET_VAR(group_concat_max_len = 4294967295) */ `User`.`id` AS `id`, (SELECT CASE WHEN COUNT(*) = 0 THEN JSON_ARRAY() ELSE CAST(COALESCE(CONCAT('[', GROUP_CONCAT(JSON_OBJECT('title', `posts__rows`.`title`) ORDER BY `posts__rows`.`posts__order_0` DESC SEPARATOR ','), ']'), CONCAT('array larger than max_allowed_packet: ', COUNT(*), ' rows')) AS JSON) END AS `posts` FROM (SELECT `Post`.`title` AS `title`, `Post`.`title` AS `posts__order_0` FROM `Post` WHERE `Post`.`authorId` = `User`.`id` ORDER BY `Post`.`title` DESC) AS `posts__rows`) AS `posts` FROM `User` WHERE `User`.`role` = ?1",
        params: ['ADMIN'],
      },
      driverCreated: 0,
    });
  });

  it('refuses a URL that is empty, cannot be parsed or names another scheme, as the Postgres facade does', async () => {
    const refusals = ['', 'not a url', 'postgres://root@localhost/app'].map((url) => {
      try {
        mysql({ contract, url });
        return undefined;
      } catch (error) {
        return Object(error).code;
      }
    });
    await expect(
      mysql({ contract }).connect({ url: 'postgres://root@localhost/app' }),
    ).rejects.toMatchObject({ code: 'RUNTIME.BINDING_INVALID' });
    expect(refusals).toEqual(Array.from({ length: 3 }, () => 'RUNTIME.BINDING_INVALID'));
  });

  it('creates its driver reading whole results unless stream is set, with the pool options it is given', () => {
    mysql({ contract }).runtime();
    mysql({
      contract,
      stream: true,
      poolOptions: { max: 3, connectionTimeoutMillis: 1000, idleTimeoutMillis: 2000 },
    }).runtime();
    expect(driverCreate.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      { stream: false },
      {
        stream: true,
        poolOptions: { max: 3, connectionTimeoutMillis: 1000, idleTimeoutMillis: 2000 },
      },
    ]);
  });

  it('checks the stream option when the factory is called, as the Postgres facade checks cursor', () => {
    for (const received of ['yes', 1, { batchSize: 10 }]) {
      expect(() =>
        mysql({
          contract,
          stream: blindCast<boolean, 'a value a caller passes past the types'>(received),
        }),
      ).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.ARGUMENT_INVALID',
          message: 'Invalid stream option',
          fix: expect.stringContaining('leave stream unset'),
          meta: { extension: 'mysql', helper: 'mysql', argument: 'stream', received },
        }),
      );
    }
    expect(() => mysql({ contract, stream: false })).not.toThrow();
  });

  it('refuses to connect without a URL', async () => {
    await expect(mysql({ contract }).connect()).rejects.toMatchObject({
      code: 'RUNTIME.BINDING_MISSING',
    });
  });

  it('offers the query surfaces without a driver through the static entry', () => {
    const { sql, enums, toSql } = mysqlStatic({ contract });
    expect({
      enums: enums.Role.values,
      sql: toSql(sql.Post.select('id').build()).sql,
    }).toEqual({
      enums: ['USER', 'ADMIN'],
      sql: 'SELECT `id` AS `id` FROM `Post`',
    });
  });
});
