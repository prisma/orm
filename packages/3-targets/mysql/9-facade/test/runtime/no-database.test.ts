import mysqlDriver from '@internal/driver-mysql/runtime';
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
