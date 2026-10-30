import { timeouts } from '@repo/test-utils';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { describe, expect, it } from 'vitest';
import type { MysqlControlDriver } from '../src/core/migrations/control-driver';
import mysqlDriver from '../src/core/migrations/control-driver';
import mysqlRuntimeDriver from '../src/core/runtime/runtime-driver';

async function connectWhileServerDefaultIncludes(
  url: string,
  sqlMode: string,
): Promise<MysqlControlDriver> {
  const admin = await mysqlDriver.create(url);
  try {
    const { rows } = await admin.query<{ mode: string }>('SELECT @@GLOBAL.sql_mode AS mode');
    const mode = rows[0]?.mode ?? '';
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
    await admin.close();
  }
}

describe('MysqlControlDriver against a MySQL server', {
  timeout: timeouts.databaseOperation,
}, () => {
  it('hands every column over as text, a binary column as bytes, in one form with values or without', async (test) => {
    await withMysqlDatabase(test, async ({ url, name }) => {
      const driver = await mysqlDriver.create(url);
      try {
        await driver.query(
          "CREATE TABLE t (i INT, b BIGINT, d DECIMAL(10,2), dt DATETIME(3), j JSON, bin VARBINARY(4), txt TEXT, e ENUM('A','B'), y YEAR, z TINYINT(3) ZEROFILL, tm TIME(2), tm0 TIME(3), db DOUBLE, f FLOAT)",
        );
        await driver.query(
          'INSERT INTO t VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 5, ?, ?, 1e21, 3.4e38)',
          [
            42,
            '9007199254740993',
            '1.50',
            '2024-01-02 03:04:05.678',
            '{"a": [1, 2]}',
            new Uint8Array([0, 1, 2, 255]),
            'héllo',
            'B',
            '25:00:00.5',
            '-01:02:03',
          ],
        );
        const row = {
          i: '42',
          b: '9007199254740993',
          d: '1.50',
          dt: '2024-01-02 03:04:05.678',
          j: '{"a": [1, 2]}',
          bin: new Uint8Array([0, 1, 2, 255]),
          txt: 'héllo',
          e: 'B',
          y: '0000',
          z: '005',
          tm: '25:00:00.50',
          tm0: '-01:02:03.000',
          db: '1e21',
          f: '3.4e38',
        };
        const runtime = mysqlRuntimeDriver.create();
        await runtime.connect({ kind: 'url', url });
        try {
          const read = async (rows: AsyncIterable<unknown>) => {
            const out: unknown[] = [];
            for await (const r of rows) out.push(r);
            return out;
          };
          expect({
            text: (await driver.query('SELECT * FROM t')).rows,
            valued: (await driver.query('SELECT * FROM t WHERE i = ?', [42])).rows,
            runtimeText: await read(runtime.query({ sql: 'SELECT * FROM t' })),
            runtimeValued: await read(
              runtime.query({ sql: 'SELECT * FROM t WHERE i = ?1', params: [42] }),
            ),
          }).toEqual({ text: [row], valued: [row], runtimeText: [row], runtimeValued: [row] });
        } finally {
          await runtime.close();
        }
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

  it('ignores a URL that asks for multiple statements, so two statements in one query are still refused', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const withMultipleStatements = new URL(url);
      withMultipleStatements.searchParams.set('multipleStatements', 'true');
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

  it('refuses two statements in one query', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = await mysqlDriver.create(url);
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
          code: 'RUNTIME.ENCODE_FAILED',
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

  it('runs concurrent calls one at a time in the order sent, so a statement with values sees the backslash mode a SET sent before it left', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = await mysqlDriver.create(url);
      try {
        const [set, valued] = await Promise.allSettled([
          driver.query("SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES'"),
          driver.query('SELECT ? AS v', ["x' , CURRENT_USER() AS injected #"]),
        ]);
        expect({ set, valued }).toEqual({
          set: { status: 'fulfilled', value: { rows: [] } },
          valued: {
            status: 'rejected',
            reason: expect.objectContaining({ code: 'RUNTIME.SQL_MODE_UNSUPPORTED' }),
          },
        });
      } finally {
        await driver.close();
      }
    });
  });

  it('sends a statement with values in one round trip, preparing nothing, as one without', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = await mysqlDriver.create(url);
      try {
        const counts = async () => {
          const { rows } = await driver.query<{ Variable_name: string; Value: string }>(
            "SHOW SESSION STATUS WHERE Variable_name IN ('Com_select', 'Com_stmt_prepare', 'Com_stmt_execute')",
          );
          return Object.fromEntries(rows.map((row) => [row.Variable_name, Number(row.Value)]));
        };
        const start = await counts();
        const withValue = await driver.query('SELECT ? AS v', ["it's"]);
        await driver.query('SELECT 1 AS v');
        const end = await counts();
        expect({
          withValue: withValue.rows,
          sent: Object.fromEntries(
            Object.entries(end).map(([name, count]) => [name, count - (start[name] ?? 0)]),
          ),
        }).toEqual({
          withValue: [{ v: "it's" }],
          sent: { Com_select: 2, Com_stmt_prepare: 0, Com_stmt_execute: 0 },
        });
      } finally {
        await driver.close();
      }
    });
  });

  it('starts its session with the session settings the stack passes, the package writing each value, the target UTC time zone and an integer setting among them', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = await mysqlDriver.create(url, {
        sessionSettings: { time_zone: '+00:00', sql_select_limit: '7' },
      });
      try {
        expect(
          await driver.query('SELECT @@SESSION.time_zone AS tz, @@SESSION.sql_select_limit AS sl'),
        ).toEqual({ rows: [{ tz: '+00:00', sl: '7' }] });
      } finally {
        await driver.close();
      }
    });
  });

  it('reports a session setting MySQL refuses as DRIVER.CONNECTION_FAILED with its reason', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      await expect(
        mysqlDriver.create(url, {
          sessionSettings: { time_zone: "+00:00' , sql_mode = 'ANSI_QUOTES" },
        }),
      ).rejects.toMatchObject({
        code: 'DRIVER.CONNECTION_FAILED',
        why: expect.stringContaining("time zone: '+00:00' , sql_mode = 'ANSI_QUOTES'"),
      });
    });
  });

  it('reports a connection the server closed as a SqlConnectionError instead of crashing', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = await mysqlDriver.create(url);
      const admin = await mysqlDriver.create(url);
      try {
        const { rows } = await driver.query<{ id: string }>('SELECT CONNECTION_ID() AS id');
        await admin.query(`KILL ${Number(rows[0]?.id)}`);
        await new Promise((resolve) => setTimeout(resolve, 200));
        await expect(driver.query('SELECT 1')).rejects.toMatchObject({
          kind: 'sql_connection',
          transient: true,
        });
      } finally {
        await admin.close();
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

  it('signs in with a password over plain TCP only when the URL allows fetching the server key, and otherwise names the two ways to allow it', async (test) => {
    await withMysqlDatabase(test, async ({ url, name }) => {
      const admin = await mysqlDriver.create(url);
      const user = `${name.slice(-12)}_u`;
      try {
        await admin.query(
          `CREATE USER '${user}'@'%' IDENTIFIED WITH caching_sha2_password BY 'pw-1'`,
        );
        await admin.query(`GRANT ALL ON \`${name}\`.* TO '${user}'@'%'`);
        const asUser = new URL(url);
        asUser.username = user;
        asUser.password = 'pw-1';
        asUser.searchParams.delete('allowPublicKeyRetrieval');
        const refused = await mysqlDriver.create(asUser.toString()).then(
          async (driver) => {
            await driver.close();
            return undefined;
          },
          (error: unknown) => error,
        );
        const pooled = mysqlRuntimeDriver.create({
          poolOptions: { connectionTimeoutMillis: 1000 },
        });
        await pooled.connect({ kind: 'url', url: asUser.toString() });
        const pooledRefused = await pooled.execute({ sql: 'SELECT 1' }).then(
          () => undefined,
          (error: unknown) => error,
        );
        await pooled.close();
        asUser.searchParams.set('allowPublicKeyRetrieval', 'true');
        const allowed = await mysqlDriver.create(asUser.toString());
        try {
          const waysOut = expect.stringMatching(/allowPublicKeyRetrieval=true.*TLS/);
          expect({
            refused,
            pooledRefused,
            user: (await allowed.query('SELECT CURRENT_USER() AS u')).rows,
          }).toEqual({
            refused: expect.objectContaining({ code: 'DRIVER.CONNECTION_FAILED', fix: waysOut }),
            pooledRefused: expect.objectContaining({
              kind: 'sql_connection',
              transient: false,
              message: waysOut,
            }),
            user: [{ u: `${user}@%` }],
          });
        } finally {
          await allowed.close();
        }
      } finally {
        await admin.query(`DROP USER IF EXISTS '${user}'@'%'`).catch(() => undefined);
        await admin.close();
      }
    });
  });

  it('connects over TLS with the settings in the URL', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const tls = new URL(url);
      tls.searchParams.set('sslmode', 'no-verify');
      const driver = await mysqlDriver.create(tls.toString());
      try {
        const { rows } = await driver.query<{ Value: string }>(
          "SHOW SESSION STATUS LIKE 'Ssl_version'",
        );
        expect(rows[0]?.Value).toMatch(/^TLS/);
      } finally {
        await driver.close();
      }
    });
  });
});
