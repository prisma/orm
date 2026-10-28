import { timeouts } from '@repo/test-utils';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { describe, expect, it } from 'vitest';
import mysqlControlDriver from '../src/core/migrations/control-driver';
import mysqlRuntimeDriver from '../src/core/runtime/runtime-driver';

async function collect<Row>(rows: AsyncIterable<Row>): Promise<Row[]> {
  const out: Row[] = [];
  for await (const row of rows) out.push(row);
  return out;
}

async function withDriver<T>(
  url: string,
  fn: (driver: ReturnType<typeof mysqlRuntimeDriver.create>) => Promise<T>,
): Promise<T> {
  const driver = mysqlRuntimeDriver.create();
  await driver.connect({ kind: 'url', url });
  try {
    return await fn(driver);
  } finally {
    await driver.close();
  }
}

const slowRows =
  "WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 200) SELECT CONNECTION_ID() AS cid, n, SLEEP(0.05) AS z, REPEAT('x', 40000) AS pad FROM s";

async function drain(rows: AsyncIterator<unknown>): Promise<void> {
  while (!(await rows.next()).done) {}
}

const numbers =
  'SELECT n FROM (SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3) AS t ORDER BY n';

describe('MySQL runtime driver', { timeout: timeouts.databaseOperation }, () => {
  it('streams a bigint, a datetime and JSON as text, and a value bound apart from the SQL', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        expect(
          await collect(
            driver.query({
              sql: "SELECT 42 AS i, CAST('2024-01-02 03:04:05.678' AS DATETIME(3)) AS d, JSON_ARRAY(1, 'a') AS j, ? AS p",
              params: ["it's"],
            }),
          ),
        ).toEqual([{ i: '42', d: '2024-01-02 03:04:05.678', j: '[1, "a"]', p: "it's" }]);
      }),
    );
  });

  it('fills only the placeholders outside quoted text, so a value cannot leave its literal', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        const value = "' OR 1=1 OR '";
        expect({
          rows: await collect(
            driver.query({
              sql: "SELECT 'why?' AS q, `a?` AS v FROM (SELECT ? AS `a?`) AS t /* ? */ WHERE \"?\" = '?'",
              params: [value],
            }),
          ),
          stats: await driver.execute({
            sql: "SELECT 'why?', ?",
            params: [value],
          }),
        }).toEqual({ rows: [{ q: 'why?', v: value }], stats: { affectedRows: 0 } });
        await expect(
          collect(driver.query({ sql: "SELECT '?' AS q", params: [value] })),
        ).rejects.toMatchObject({ code: 'RUNTIME.PARAM_PLACEHOLDER_MISMATCH' });
      }),
    );
  });

  it('refuses a charset in the URL, and keeps a value whose characters a narrow charset would turn into quotes inside its literal', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const latin1 = new URL(url);
      latin1.searchParams.set('charset', 'latin1');
      const narrow = mysqlRuntimeDriver.create();
      await expect(narrow.connect({ kind: 'url', url: latin1.toString() })).rejects.toMatchObject({
        code: 'RUNTIME.BINDING_INVALID',
      });
      await withDriver(url, async (driver) => {
        const leaks = [];
        for (const value of ['ħ OR TRUE -- ', "¥' OR TRUE -- "]) {
          leaks.push(
            ...(await collect(
              driver.query({
                sql: "SELECT 'leaked' AS r FROM DUAL WHERE 'secret' = ?1",
                params: [value],
              }),
            )),
          );
        }
        expect(leaks).toEqual([]);
      });
    });
  });

  it('keeps a value inside its literal even after a held connection turns on NO_BACKSLASH_ESCAPES', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        const value = "\\' OR TRUE -- ";
        const connection = await driver.acquireConnection();
        try {
          const probe = {
            sql: "SELECT 'leaked' AS r FROM DUAL WHERE 'secret' = ?1",
            params: [value],
          };
          const before = await collect(connection.query(probe));
          const awkward = "it's \\ a\nb\u0000c";
          const roundTrip = await collect(
            connection.query({
              sql: 'SELECT ?1 AS v, ?2 AS w',
              params: [value, awkward],
            }),
          );
          await connection.execute({
            sql: "SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',NO_BACKSLASH_ESCAPES')",
          });
          const after = await collect(connection.query(probe));
          expect({ before, roundTrip, after }).toEqual({
            before: [],
            roundTrip: [{ v: value, w: awkward }],
            after: [],
          });
        } finally {
          await connection.destroy();
        }
      }),
    );
  });

  it('binds numbered placeholders as prepared statement values, repeated and reordered, beside a ? in a literal', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        expect(
          await collect(
            driver.query({
              sql: "SELECT 'why?' AS q, ?2 AS b, ?1 AS a, ?2 AS c FROM DUAL LIMIT ?3",
              params: ['x', 'y', 1],
            }),
          ),
        ).toEqual([{ q: 'why?', b: 'y', a: 'x', c: 'y' }]);
      }),
    );
  });

  it('keeps no more prepared statements open than the cache size on each connection', async (test) => {
    await withMysqlDatabase(test, async ({ url, name }) => {
      const cached = new URL(url);
      cached.searchParams.set('statementCacheSize', '5');
      cached.searchParams.set('connectionLimit', '2');
      const admin = await mysqlControlDriver.create(url);
      try {
        await withDriver(cached.toString(), async (driver) => {
          const sizes = Array.from({ length: 300 }, (_, i) => i + 1);
          for (let start = 0; start < sizes.length; start += 10) {
            await Promise.all(
              sizes.slice(start, start + 10).map((size) => {
                const list = Array.from({ length: size }, (_, i) => `?${i + 1}`).join(', ');
                return collect(
                  driver.query({
                    sql: `SELECT 1 AS n FROM DUAL WHERE 1 IN (${list})`,
                    params: Array.from({ length: size }, (_, i) => i + 1),
                  }),
                );
              }),
            );
          }
          const { rows } = await admin.query<{ open: string }>(
            'SELECT COUNT(*) AS open FROM performance_schema.prepared_statements_instances p JOIN performance_schema.threads t ON p.OWNER_THREAD_ID = t.THREAD_ID WHERE t.PROCESSLIST_DB = ? AND t.PROCESSLIST_ID <> CONNECTION_ID()',
            [name],
          );
          expect(Number(rows[0]?.open)).toBeLessThanOrEqual(10);
        });
      } finally {
        await admin.close();
      }
    });
  });

  it('refuses a statement MySQL cannot prepare with DRIVER.PREPARE_FAILED', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        await driver.execute({ sql: 'CREATE TABLE t (id int)' });
        await expect(driver.execute({ sql: 'LOCK TABLES t READ' })).rejects.toMatchObject({
          code: 'DRIVER.PREPARE_FAILED',
        });
      }),
    );
  });

  it('reads each column type from the binary protocol in the form its codec takes', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        await driver.execute({
          sql: "CREATE TABLE t (i INT, b BIGINT, ub BIGINT UNSIGNED, d DECIMAL(65,30), dt DATETIME(3), dd DATE, tm TIME(3), j JSON, vc VARCHAR(10), c CHAR(3), tx TEXT, e ENUM('A','B'), vb VARBINARY(4), f FLOAT, y YEAR)",
        });
        await driver.execute({
          sql: "INSERT INTO t VALUES (?1, ?2, ?3, ?4, ?5, '2026-10-23', '01:02:03.450', '{\"a\": 1}', ?6, 'ab', 'tx', 'B', X'00ff', 0.1, 2026)",
          params: [
            -7,
            9223372036854775807n,
            '18446744073709551615',
            '1.000000000000000000000000000001',
            '2026-10-23 01:02:03.456',
            "ħ\\'",
          ],
        });
        expect(await collect(driver.query({ sql: 'SELECT * FROM t' }))).toEqual([
          {
            i: -7,
            b: '9223372036854775807',
            ub: '18446744073709551615',
            d: '1.000000000000000000000000000001',
            dt: '2026-10-23 01:02:03.456',
            dd: '2026-10-23',
            tm: '01:02:03.45',
            j: '{"a": 1}',
            vc: "ħ\\'",
            c: 'ab',
            tx: 'tx',
            e: 'B',
            vb: Buffer.from([0, 255]),
            f: 0.10000000149011612,
            y: 2026,
          },
        ]);
      }),
    );
  });

  it('refuses a statement whose placeholder count MySQL reads differently from the values, before running it, under NO_BACKSLASH_ESCAPES set on a held connection', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        const connection = await driver.acquireConnection();
        try {
          await connection.execute({
            sql: "SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES'",
          });
          await expect(
            collect(connection.query({ sql: "SELECT 'x\\' AS a, ? AS b" })),
          ).rejects.toMatchObject({
            code: 'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
            meta: expect.objectContaining({ prepared: 1, params: 0 }),
          });
          await expect(
            connection.execute({ sql: "SELECT 'x\\' AS a, ? AS b" }),
          ).rejects.toMatchObject({ code: 'RUNTIME.PARAM_PLACEHOLDER_MISMATCH' });
        } finally {
          await connection.destroy();
        }
      }),
    );
  });

  it('keeps a SET on its connection after the connection goes back to the pool, as Postgres does', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const single = new URL(url);
      single.searchParams.set('connectionLimit', '1');
      await withDriver(single.toString(), async (driver) => {
        const zone = () =>
          collect(
            driver.query<Record<string, string>>({ sql: 'SELECT @@SESSION.time_zone AS tz' }),
          );
        const before = await zone();
        await driver.execute({ sql: "SET time_zone = '+05:00'" });
        expect({ before, after: await zone() }).toEqual({
          before: [{ tz: '+00:00' }],
          after: [{ tz: '+05:00' }],
        });
      });
    });
  });

  it('refuses a LIMIT value that is not an integer with RUNTIME.ARGUMENT_INVALID', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        await expect(
          collect(
            driver.query({
              sql: 'SELECT 1 AS n FROM DUAL LIMIT ?1',
              params: [1.5],
            }),
          ),
        ).rejects.toMatchObject({ code: 'RUNTIME.ARGUMENT_INVALID' });
      }),
    );
  });

  it('sets up every connection: no backslash escapes mode and UTC', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        const [row] = await collect(
          driver.query<Record<string, string>>({
            sql: "SELECT @@SESSION.time_zone AS tz, FIND_IN_SET('NO_BACKSLASH_ESCAPES', @@SESSION.sql_mode) AS nbe",
          }),
        );
        expect(row).toEqual({ tz: '+00:00', nbe: '0' });
      }),
    );
  });

  it('leaves a connection usable after its caller stops reading a stream early', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        const connection = await driver.acquireConnection();
        try {
          for await (const row of connection.query({ sql: numbers })) {
            expect(row).toEqual({ n: '1' });
            break;
          }
          expect(await collect(connection.query({ sql: 'SELECT 7 AS n' }))).toEqual([{ n: '7' }]);
        } finally {
          await connection.release();
        }
      }),
    );
  });

  it('stops a pooled stream the caller breaks out of without reading the rest of the result', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        const started = Date.now();
        for await (const _row of driver.query({ sql: slowRows })) break;
        const elapsedMs = Date.now() - started;
        expect({
          quick: elapsedMs < 3000,
          next: await collect(driver.query({ sql: 'SELECT 1 AS n' })),
        }).toEqual({ quick: true, next: [{ n: '1' }] });
      }),
    );
  });

  it('gives up waiting for a pooled connection after the pool timeout', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const limited = new URL(url);
      limited.searchParams.set('connectionLimit', '1');
      limited.searchParams.set('poolTimeout', '200');
      await withDriver(limited.toString(), async (driver) => {
        const held = await driver.acquireConnection();
        const waiting = collect(driver.query({ sql: 'SELECT 1 AS n' }));
        await expect(waiting).rejects.toMatchObject({ code: 'DRIVER.CONNECTION_FAILED' });
        await held.release();
        expect(await collect(driver.query({ sql: 'SELECT 2 AS n' }))).toEqual([{ n: '2' }]);
      });
    });
  });

  it('commits and rolls back a transaction on one connection, and reports affected rows', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        await driver.execute({ sql: 'CREATE TABLE t (id int PRIMARY KEY)' });
        const connection = await driver.acquireConnection();
        try {
          const rolledBack = await connection.beginTransaction();
          await rolledBack.execute({
            sql: 'INSERT INTO t VALUES (?), (?)',
            params: [1, 2],
          });
          await rolledBack.rollback();
          const committed = await connection.beginTransaction();
          const stats = await committed.execute({
            sql: 'INSERT INTO t VALUES (?), (?)',
            params: [3, 4],
          });
          await committed.commit();
          expect({
            stats,
            rows: await collect(driver.query({ sql: 'SELECT id FROM t ORDER BY id' })),
          }).toEqual({ stats: { affectedRows: 2 }, rows: [{ id: 3 }, { id: 4 }] });
        } finally {
          await connection.release();
        }
      }),
    );
  });

  it('waits in close() for a stream in flight to finish', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = mysqlRuntimeDriver.create();
      await driver.connect({ kind: 'url', url });
      const iterator = driver.query({ sql: numbers })[Symbol.asyncIterator]();
      const first = await iterator.next();
      let closed = false;
      const closing = driver.close().then(() => {
        closed = true;
      });
      const rest = [await iterator.next(), await iterator.next(), await iterator.next()];
      await closing;
      expect({ first, rest, closed, state: driver.state }).toEqual({
        first: { done: false, value: { n: '1' } },
        rest: [
          { done: false, value: { n: '2' } },
          { done: false, value: { n: '3' } },
          { done: true, value: undefined },
        ],
        closed: true,
        state: 'closed',
      });
    });
  });

  it('waits in close() for a connection it handed out to be released', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = mysqlRuntimeDriver.create();
      await driver.connect({ kind: 'url', url });
      const connection = await driver.acquireConnection();
      let closed = false;
      const closing = driver.close().then(() => {
        closed = true;
      });
      const rows = await collect(connection.query({ sql: 'SELECT 1 AS n' }));
      const closedBeforeRelease = closed;
      await connection.release();
      await closing;
      expect({ rows, closedBeforeRelease, closed }).toEqual({
        rows: [{ n: '1' }],
        closedBeforeRelease: false,
        closed: true,
      });
    });
  });

  it('ends a stream whose connection is lost with DRIVER.NOT_CONNECTED, and close() still finishes', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const admin = await mysqlControlDriver.create(url);
      const driver = mysqlRuntimeDriver.create();
      await driver.connect({ kind: 'url', url });
      try {
        const rows = driver.query<{ cid: string }>({ sql: slowRows })[Symbol.asyncIterator]();
        const first = await rows.next();
        await admin.query(`KILL ${first.done ? '' : first.value.cid}`);
        await expect(drain(rows)).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
        await driver.close();
        expect(driver.state).toBe('closed');
      } finally {
        await admin.close();
      }
    });
  });

  it('stops reading a held connection that is lost after the caller broke out of its stream', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const admin = await mysqlControlDriver.create(url);
      const driver = mysqlRuntimeDriver.create();
      await driver.connect({ kind: 'url', url });
      try {
        const connection = await driver.acquireConnection();
        for await (const row of connection.query<{ cid: string }>({
          sql: slowRows,
        })) {
          await admin.query(`KILL ${row.cid}`);
          break;
        }
        await connection.destroy();
        await driver.close();
        expect(driver.state).toBe('closed');
      } finally {
        await admin.close();
      }
    });
  });

  it('reports a query error with its SQLSTATE', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        await expect(collect(driver.query({ sql: 'SELECT * FROM missing' }))).rejects.toMatchObject(
          { sqlState: '42S02' },
        );
        expect(await collect(driver.query({ sql: 'SELECT 1 AS n' }))).toEqual([{ n: '1' }]);
      }),
    );
  });
});

describe('MySQL runtime driver before connect', () => {
  it('refuses to run anything', async () => {
    const driver = mysqlRuntimeDriver.create();
    await expect(collect(driver.query({ sql: 'SELECT 1' }))).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
    });
    await expect(driver.execute({ sql: 'SELECT 1' })).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
    });
    await expect(driver.acquireConnection()).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
    });
    expect(driver.state).toBe('unbound');
  });
});
