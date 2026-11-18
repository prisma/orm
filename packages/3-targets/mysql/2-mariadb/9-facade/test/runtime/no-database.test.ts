import mariadbDriver from '@internal/driver-mariadb/runtime';
import { contractFromJson as mysqlContractFromJson } from '@internal/mysql/static';
import type { NoCollectionClasses } from '@internal/sql-orm-client';
import type { SqlExecutionOptions } from '@internal/sql-runtime';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import mysqlContractJson from '../../../../1-mysql/9-facade/test/fixtures/generated/contract.json' with {
  type: 'json',
};
import mariadb, { type MariadbOptions, type MariadbOptionsBase } from '../../src/exports/runtime';
import mariadbStatic, { contractFromJson } from '../../src/exports/static';
import type { Contract } from '../fixtures/generated/contract.d';
import contractJson from '../fixtures/generated/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);

let driverCreate: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  driverCreate = vi.spyOn(mariadbDriver, 'create');
});

afterEach(() => {
  driverCreate.mockRestore();
});

function codeOf(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return { code: Object(error).code, message: Object(error).message };
  }
}

describe('a MariaDB client with no database', () => {
  it('renders the SQL builder as MariaDB takes it, without a driver', () => {
    const db = mariadb({ contract });
    const { sql } = db.toSql(
      db.sql.User.select('id')
        .where((f, fns) => fns.eq(f.role, 'ADMIN'))
        .build(),
    );
    expect({ sql, driverCreated: driverCreate.mock.calls.length }).toEqual({
      sql: 'SELECT `id` AS `id` FROM `User` WHERE `User`.`role` = ?1',
      driverCreated: 0,
    });
  });

  it('takes a mariadb:// or a mysql:// URL, and names MariaDB when it refuses another', async () => {
    expect({
      mariadb: codeOf(() => mariadb({ contract, url: 'mariadb://root@localhost/app' })),
      mysql: codeOf(() => mariadb({ contract, url: 'mysql://root@localhost/app' })),
      postgres: codeOf(() => mariadb({ contract, url: 'postgres://root@localhost/app' })),
    }).toEqual({
      mariadb: undefined,
      mysql: undefined,
      postgres: {
        code: 'RUNTIME.BINDING_INVALID',
        message: 'MariaDB URL must use mariadb:// or mysql://',
      },
    });
  });

  it('names MariaDB and mariadb() when it is asked to connect without a URL', async () => {
    await expect(mariadb({ contract }).connect()).rejects.toMatchObject({
      code: 'RUNTIME.BINDING_MISSING',
      message:
        'MariaDB binding not configured. Pass url to mariadb(...) or call db.connect({ url }).',
      meta: { extension: 'mariadb' },
    });
  });

  it('refuses a contract emitted for MySQL with the runtime target-mismatch error', () => {
    const mysqlContract = mysqlContractFromJson<Contract>(mysqlContractJson);
    expect(codeOf(() => mariadb({ contract: mysqlContract }))).toMatchObject({
      code: 'RUNTIME.CONTRACT_TARGET_MISMATCH',
    });
  });

  it('creates its driver with the options mysql() takes, under the MariaDB target id', () => {
    const db = mariadb({
      contract,
      stream: true,
      poolOptions: { max: 3 },
      transactionOptions: { isolationLevel: 'Serializable' },
    });
    db.runtime();
    expect({
      options: driverCreate.mock.calls.map((call: unknown[]) => call[0]),
      targetId: db.stack.driver.targetId,
      adapterTargetId: db.stack.adapter.targetId,
    }).toEqual({
      options: [{ stream: true, poolOptions: { max: 3 } }],
      targetId: 'mariadb',
      adapterTargetId: 'mariadb',
    });
  });

  it('takes the options mysql() takes', () => {
    expectTypeOf<MariadbOptions<Contract>>().toEqualTypeOf<
      MariadbOptionsBase & {
        readonly contract: Contract;
        readonly collections?: NoCollectionClasses;
        readonly url?: string;
      }
    >();
    expectTypeOf<Pick<MariadbOptionsBase, keyof SqlExecutionOptions<'mariadb'>>>().toEqualTypeOf<
      SqlExecutionOptions<'mariadb'>
    >();
  });

  it('offers the query surfaces without a driver through the static entry', () => {
    const { sql, enums, toSql } = mariadbStatic({ contract });
    expect({
      enums: enums.Role.values,
      sql: toSql(sql.Post.select('id').build()).sql,
    }).toEqual({
      enums: ['USER', 'ADMIN'],
      sql: 'SELECT `id` AS `id` FROM `Post`',
    });
  });
});
