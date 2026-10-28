import { timeouts } from '@repo/test-utils';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { createConnection } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import type { MysqlControlDriver } from '../src/core/migrations/control-driver';
import mysqlDriver from '../src/core/migrations/control-driver';

async function connectWhileServerDefaultIncludes(
  url: string,
  sqlMode: string,
): Promise<MysqlControlDriver> {
  const admin = await createConnection(url);
  try {
    const [rows] = await admin.query('SELECT @@GLOBAL.sql_mode AS mode');
    const [{ mode }] = rows as [{ mode: string }];
    await admin.query(`SET GLOBAL sql_mode = '${[mode, sqlMode].filter(Boolean).join(',')}'`);
    let driver: MysqlControlDriver | undefined;
    try {
      driver = await mysqlDriver.create(url);
      return driver;
    } finally {
      await admin.query(`SET GLOBAL sql_mode = '${mode}'`).catch(async (error: unknown) => {
        await driver?.close().catch(() => undefined);
        throw error;
      });
    }
  } finally {
    await admin.end();
  }
}

describe('MysqlControlDriver against a MySQL server', {
  timeout: timeouts.databaseOperation,
}, () => {
  it('hands every column over as the text MySQL sends', async (test) => {
    await withMysqlDatabase(test, async ({ url, name }) => {
      const driver = await mysqlDriver.create(url);
      try {
        await driver.query(
          "CREATE TABLE t (i INT, b BIGINT, d DECIMAL(10,2), dt DATETIME(3), j JSON, bin VARBINARY(4), txt TEXT, e ENUM('A','B'))",
        );
        await driver.query('INSERT INTO t VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          42,
          '9007199254740993',
          '1.50',
          '2024-01-02 03:04:05.678',
          '{"a": [1, 2]}',
          Buffer.from([0, 1, 2, 255]),
          'héllo',
          'B',
        ]);
        const { rows } = await driver.query('SELECT * FROM t');
        expect(rows).toEqual([
          {
            i: '42',
            b: '9007199254740993',
            d: '1.50',
            dt: '2024-01-02 03:04:05.678',
            j: '{"a": [1, 2]}',
            bin: Buffer.from([0, 1, 2, 255]),
            txt: 'héllo',
            e: 'B',
          },
        ]);
        expect(await driver.databaseName()).toBe(name);
      } finally {
        await driver.close();
      }
    });
  });

  it('returns no rows for a statement that is not a query', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = await mysqlDriver.create(url);
      try {
        expect(await driver.query('CREATE TABLE u (id INT)')).toEqual({ rows: [] });
      } finally {
        await driver.close();
      }
    });
  });

  it('refuses a charset in the URL', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const latin1 = new URL(url);
      latin1.searchParams.set('charset', 'latin1');
      await expect(mysqlDriver.create(latin1.toString())).rejects.toMatchObject({
        code: 'RUNTIME.BINDING_INVALID',
      });
    });
  });

  it('refuses a URL that asks for multiple statements', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const withMultipleStatements = new URL(url);
      withMultipleStatements.searchParams.set('multipleStatements', 'true');
      await expect(mysqlDriver.create(withMultipleStatements.toString())).rejects.toMatchObject({
        code: 'RUNTIME.BINDING_INVALID',
      });
    });
  });

  it('refuses two statements in one query even when the URL flags multiple statements', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const withMultipleStatements = new URL(url);
      withMultipleStatements.searchParams.set('flags', 'MULTI_STATEMENTS');
      const driver = await mysqlDriver.create(withMultipleStatements.toString());
      try {
        await expect(driver.query('SELECT 1; SELECT 2')).rejects.toMatchObject({
          kind: 'sql_query',
          sqlState: '42000',
        });
      } finally {
        await driver.close();
      }
    });
  });

  it('refuses an object parameter rather than writing it as SQL', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = await mysqlDriver.create(url);
      try {
        await expect(driver.query('SELECT ? AS v', [{ id: 1 }])).rejects.toMatchObject({
          code: 'RUNTIME.AST_INVALID',
        });
      } finally {
        await driver.close();
      }
    });
  });

  it('fills only the placeholders outside quoted text, so a value cannot leave its literal', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = await mysqlDriver.create(url);
      try {
        const value = "' OR 1=1 OR '";
        expect(await driver.query("SELECT 'why?' AS q, ? AS v /* ? */ -- ?\n", [value])).toEqual({
          rows: [{ q: 'why?', v: value }],
        });
        await expect(driver.query("SELECT '?' AS q", [value])).rejects.toMatchObject({
          code: 'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
        });
      } finally {
        await driver.close();
      }
    });
  });

  it('escapes parameters correctly when the server default sets NO_BACKSLASH_ESCAPES', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = await connectWhileServerDefaultIncludes(url, 'NO_BACKSLASH_ESCAPES');
      try {
        const value = "it\\'s ' OR 1=1 -- ";
        const { rows } = await driver.query<{ v: string; mode: string }>(
          'SELECT ? AS v, @@SESSION.sql_mode AS mode',
          [value],
        );
        expect({
          v: rows[0]?.v,
          flagged: rows[0]?.mode.split(',').includes('NO_BACKSLASH_ESCAPES'),
        }).toEqual({
          v: value,
          flagged: false,
        });
      } finally {
        await driver.close();
      }
    });
  });

  it('clears ANSI_QUOTES, so a double-quoted string is read as the driver scans it', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = await connectWhileServerDefaultIncludes(url, 'ANSI_QUOTES');
      try {
        const rows = await driver
          .query<Record<string, string>>(
            "SELECT 'leaked' AS \"r\\\", 'x\"' AS s FROM DUAL WHERE FALSE OR ' = ?1 OR ' -- '\n",
            [' OR TRUE OR '],
          )
          .then(
            (result) => result.rows,
            () => [],
          );
        const { rows: mode } = await driver.query<{ ansi: string }>(
          "SELECT FIND_IN_SET('ANSI_QUOTES', @@SESSION.sql_mode) AS ansi",
        );
        expect({ rows, mode }).toEqual({ rows: [], mode: [{ ansi: '0' }] });
      } finally {
        await driver.close();
      }
    });
  });

  it('runs a statement with values as a prepared statement, and SQL with none as text', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = await mysqlDriver.create(url);
      try {
        const executed = async () => {
          const { rows } = await driver.query<{ Value: string }>(
            "SHOW SESSION STATUS LIKE 'Com_stmt_execute'",
          );
          return Number(rows[0]?.Value);
        };
        const start = await executed();
        const withValue = await driver.query('SELECT ? AS v', ["it's"]);
        const afterValue = await executed();
        await driver.query('SELECT 1 AS v');
        const afterConstant = await executed();
        expect({
          withValue: withValue.rows,
          prepared: afterValue - start,
          constant: afterConstant - afterValue,
        }).toEqual({ withValue: [{ v: "it's" }], prepared: 1, constant: 0 });
      } finally {
        await driver.close();
      }
    });
  });

  it('runs its session in UTC', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = await mysqlDriver.create(url);
      try {
        expect(await driver.query('SELECT @@SESSION.time_zone AS tz')).toEqual({
          rows: [{ tz: '+00:00' }],
        });
      } finally {
        await driver.close();
      }
    });
  });

  it('reports a connection the server closed as DRIVER.NOT_CONNECTED instead of crashing', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = await mysqlDriver.create(url);
      const admin = await createConnection(url);
      try {
        const { rows } = await driver.query<{ id: string }>('SELECT CONNECTION_ID() AS id');
        await admin.query(`KILL ${Number(rows[0]?.id)}`);
        await new Promise((resolve) => setTimeout(resolve, 200));
        await expect(driver.query('SELECT 1')).rejects.toMatchObject({
          code: 'DRIVER.NOT_CONNECTED',
        });
      } finally {
        await admin.end();
        await driver.close();
      }
    });
  });

  it('reports a failed statement as a SqlQueryError with its SQLSTATE', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = await mysqlDriver.create(url);
      try {
        await expect(driver.query('SELECT * FROM missing')).rejects.toMatchObject({
          kind: 'sql_query',
          sqlState: '42S02',
        });
      } finally {
        await driver.close();
      }
    });
  });

  it('reports a database it cannot reach as DRIVER.CONNECTION_FAILED with the URL redacted', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const missing = new URL(url);
      missing.pathname = '/no_such_database_for_prisma';
      missing.password = 'secret';
      const error = await mysqlDriver.create(missing.toString()).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toMatchObject({ code: 'DRIVER.CONNECTION_FAILED' });
      const { message, why, meta } = error as { message: string; why: string; meta: unknown };
      expect(JSON.stringify({ message, why, meta })).not.toContain('secret');
      expect(JSON.stringify(meta)).toContain('no_such_database_for_prisma');
    });
  });
});
