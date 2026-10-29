import { connect, createServer } from 'node:net';
import { inspect } from 'node:util';
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

type DriverOptions = Parameters<typeof mysqlRuntimeDriver.create>[0];

async function withDriver<T>(
  url: string,
  fn: (driver: ReturnType<typeof mysqlRuntimeDriver.create>) => Promise<T>,
  options?: DriverOptions,
): Promise<T> {
  const driver = mysqlRuntimeDriver.create(options);
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

const tenSlowRows =
  'WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 10) SELECT n, SLEEP(0.05) AS z FROM s';

const numbers =
  'SELECT n FROM (SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3) AS t ORDER BY n';

const streaming = { stream: true } as const;
const single = { stream: true, poolOptions: { max: 1 } } as const;

const twoHundredNumbers =
  'WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 200) SELECT n FROM s';

/**
 * Runs `fn` with a URL for a new user of its own on the test database, and a function that counts the connections that user has opened on the server. A user of its own keeps the count apart from other tests sharing the server.
 */
async function withCountedUser<T>(
  url: string,
  name: string,
  fn: (userUrl: URL, opened: () => Promise<number>) => Promise<T>,
): Promise<T> {
  const admin = await mysqlControlDriver.create(url);
  const user = `${name.slice(-12)}_c`;
  try {
    await admin.query(`CREATE USER '${user}'@'%' IDENTIFIED BY 'pw-counted'`);
    await admin.query(`GRANT ALL ON \`${name}\`.* TO '${user}'@'%'`);
    const userUrl = new URL(url);
    userUrl.username = user;
    userUrl.password = 'pw-counted';
    userUrl.searchParams.set('allowPublicKeyRetrieval', 'true');
    const opened = async () => {
      const { rows } = await admin.query<{ n: string }>(
        'SELECT COALESCE(SUM(TOTAL_CONNECTIONS), 0) AS n FROM performance_schema.accounts WHERE USER = ?',
        [user],
      );
      return Number(rows[0]?.n);
    };
    return await fn(userUrl, opened);
  } finally {
    await admin.query(`DROP USER IF EXISTS '${user}'@'%'`).catch(() => undefined);
    await admin.close();
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

async function connectionId(driver: ReturnType<typeof mysqlRuntimeDriver.create>) {
  const [row] = await collect(
    driver.query<{ id: bigint }>({ sql: 'SELECT CONNECTION_ID() AS id' }),
  );
  return row?.id;
}

describe('MySQL runtime driver', { timeout: timeouts.databaseOperation }, () => {
  it('streams an integer, a datetime and JSON as text, and a value bound apart from the SQL', async (test) => {
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

  async function openStatements(url: string, name: string): Promise<number> {
    const admin = await mysqlControlDriver.create(url);
    try {
      const { rows } = await admin.query<{ open: string }>(
        'SELECT COUNT(*) AS open FROM performance_schema.prepared_statements_instances p JOIN performance_schema.threads t ON p.OWNER_THREAD_ID = t.THREAD_ID WHERE t.PROCESSLIST_DB = ? AND t.PROCESSLIST_ID <> CONNECTION_ID()',
        [name],
      );
      return Number(rows[0]?.open);
    } finally {
      await admin.close();
    }
  }

  async function runManyStatements(driver: ReturnType<typeof mysqlRuntimeDriver.create>) {
    const sizes = Array.from({ length: 60 }, (_, i) => i + 1);
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
  }

  it('closes every prepared statement after it runs, so a process never holds statements open against the server-wide limit', async (test) => {
    await withMysqlDatabase(test, async ({ url, name }) => {
      const open = await withDriver(
        url,
        async (driver) => {
          await runManyStatements(driver);
          return openStatements(url, name);
        },
        { poolOptions: { max: 2 } },
      );
      expect(open).toBe(0);
    });
  });

  it('sends integers as BIGINT, so a comparison with no column compares numbers and LIMIT takes the largest INT', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        expect({
          compared: await collect(
            driver.query({
              sql: 'SELECT ?1 < ?2 AS lt, ?3 < ?4 AS text_lt',
              params: [10, 9, '10', '9'],
            }),
          ),
          limited: await collect(
            driver.query({ sql: 'SELECT 1 AS n FROM DUAL LIMIT ?1', params: [2147483647] }),
          ),
          offset: await collect(
            driver.query({
              sql: 'SELECT 1 AS n FROM DUAL LIMIT ?1 OFFSET ?2',
              params: [2 ** 53, 0],
            }),
          ),
        }).toEqual({
          compared: [{ lt: '0', text_lt: '1' }],
          limited: [{ n: '1' }],
          offset: [{ n: '1' }],
        });
      }),
    );
  });

  it('round-trips the ends of the signed 64-bit range and bytes, sends a whole number past it as a double, and refuses a bigint past it or a Date without crashing', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        await driver.execute({ sql: 'CREATE TABLE t (b BIGINT, v VARBINARY(4), d DOUBLE)' });
        await driver.execute({
          sql: 'INSERT INTO t VALUES (?1, ?2, ?3), (?4, NULL, ?5)',
          params: [-(2n ** 63n), new Uint8Array([0, 1, 255]), 1e19, 2n ** 63n - 1n, 1e20],
        });
        for (const value of [-(2n ** 63n) - 1n, 2n ** 64n, new Date(0)]) {
          await expect(
            driver.execute({ sql: 'INSERT INTO t (b) VALUES (?1)', params: [value] }),
          ).rejects.toMatchObject({ code: 'RUNTIME.ENCODE_FAILED' });
        }
        expect({
          rows: await collect(driver.query({ sql: 'SELECT b, v, d FROM t ORDER BY b' })),
          below: await collect(
            driver.query({ sql: 'SELECT COUNT(*) AS n FROM t WHERE d < ?1', params: [1e20] }),
          ),
        }).toEqual({
          rows: [
            {
              b: '-9223372036854775808',
              v: new Uint8Array([0, 1, 255]),
              d: '1e19',
            },
            { b: '9223372036854775807', v: null, d: '1e20' },
          ],
          below: [{ n: '1' }],
        });
      }),
    );
  });

  it('runs a raw statement without values over the text protocol, as pg does, so START TRANSACTION and LOCK TABLES, which MySQL does not prepare, run', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        await driver.execute({ sql: 'CREATE TABLE t (id int)' });
        const connection = await driver.acquireConnection();
        try {
          await connection.execute({ sql: 'LOCK TABLES t WRITE' });
          await connection.execute({ sql: 'START TRANSACTION' });
          await connection.execute({ sql: 'INSERT INTO t VALUES (?1)', params: [1] });
          await connection.execute({ sql: 'COMMIT' });
          await connection.execute({ sql: 'UNLOCK TABLES' });
        } finally {
          await connection.release();
        }
        expect(await collect(driver.query({ sql: 'SELECT id FROM t' }))).toEqual([{ id: '1' }]);
      }),
    );
  });

  it('returns every column type as text, binary columns as bytes and NULL as null, on a pooled and a held connection, over the text protocol and prepared', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        await driver.execute({
          sql: "CREATE TABLE t (i INT, ti TINYINT(1), b BIGINT, ub BIGINT UNSIGNED, d DECIMAL(65,30), f FLOAT, db DOUBLE, y YEAR, dt DATETIME(3), dd DATE, tm TIME(3), j JSON, vc VARCHAR(10), c CHAR(3), tx TEXT, e ENUM('A','B'), st SET('a','b'), vb VARBINARY(4), bl BLOB, bt BIT(1), n INT)",
        });
        await driver.execute({
          sql: "INSERT INTO t VALUES (?1, 1, ?2, ?3, ?4, 0.1, 0.1, 2026, ?5, '2026-10-23', '01:02:03.450', '{\"a\": 1}', ?6, 'ab', 'tx', 'B', 'a,b', X'00ff', X'01', b'1', NULL)",
          params: [
            '-7',
            '9223372036854775807',
            '18446744073709551615',
            '1.000000000000000000000000000001',
            '2026-10-23 01:02:03.456',
            "ħ\\'",
          ],
        });
        const row = {
          i: '-7',
          ti: '1',
          b: '9223372036854775807',
          ub: '18446744073709551615',
          d: '1.000000000000000000000000000001',
          f: '0.1',
          db: '0.1',
          y: '2026',
          dt: '2026-10-23 01:02:03.456',
          dd: '2026-10-23',
          tm: '01:02:03.450',
          j: '{"a": 1}',
          vc: "ħ\\'",
          c: 'ab',
          tx: 'tx',
          e: 'B',
          st: 'a,b',
          vb: new Uint8Array([0, 255]),
          bl: new Uint8Array([1]),
          bt: new Uint8Array([1]),
          n: null,
        };
        const prepared = { sql: 'SELECT * FROM t WHERE ?1 = ?1', params: [1] };
        const connection = await driver.acquireConnection();
        try {
          expect({
            pooled: await collect(driver.query({ sql: 'SELECT * FROM t' })),
            held: await collect(connection.query({ sql: 'SELECT * FROM t' })),
            pooledPrepared: await collect(driver.query(prepared)),
            heldPrepared: await collect(connection.query(prepared)),
          }).toEqual({ pooled: [row], held: [row], pooledPrepared: [row], heldPrepared: [row] });
        } finally {
          await connection.release();
        }
      }),
    );
  });

  it('reads a FLOAT and a DOUBLE as MySQL writes them over the text protocol, negative zero included, whether the row came over the text protocol or prepared', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        await driver.execute({ sql: 'CREATE TABLE t (id INT, f FLOAT, d DOUBLE)' });
        await driver.execute({
          sql: 'INSERT INTO t VALUES (1, -0e0, -0e0), (2, 0.1, 1e20), (3, 3.4e38, 1e-7), (4, 1e-16, 1e15), (5, 2.5, 4233813289058719.5)',
        });
        const rows = [
          { f: '-0', d: '-0' },
          { f: '0.1', d: '1e20' },
          { f: '3.4e38', d: '0.0000001' },
          { f: '1e-16', d: '1e15' },
          { f: '2.5', d: '4233813289058719.5' },
        ];
        expect({
          text: await collect(driver.query({ sql: 'SELECT f, d FROM t ORDER BY id' })),
          prepared: await collect(
            driver.query({ sql: 'SELECT f, d FROM t WHERE ?1 = ?1 ORDER BY id', params: [1] }),
          ),
        }).toEqual({ text: rows, prepared: rows });
      }),
    );
  });

  it('reads a FLOAT and a DOUBLE declared with decimals with exactly those decimals, as MySQL writes them over the text protocol, whether the row came over the text protocol or prepared', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        await driver.execute({
          sql: 'CREATE TABLE t (id INT, f FLOAT(12,6), d DOUBLE(10,2), w DOUBLE(40,30), z FLOAT(10,1))',
        });
        await driver.execute({
          sql: 'INSERT INTO t VALUES (1, 1234.5677e0, 1.5e0, 0.1e0, 5e0), (2, 0.1e0, 100e0, 1e-25, -7e0), (3, -0.5e0, -12345678.9e0, 1e0/3e0, 0e0), (4, 98765.4321e0, 0e0, 123456789.123456789e0, 2097152.3e0)',
        });
        const rows = [
          { f: '1234.567749', d: '1.50', w: '0.100000000000000000000000000000', z: '5.0' },
          { f: '0.100000', d: '100.00', w: '0.000000000000000000000000100000', z: '-7.0' },
          { f: '-0.500000', d: '-12345678.90', w: '0.333333333333333300000000000000', z: '0.0' },
          {
            f: '98765.429688',
            d: '0.00',
            w: '123456789.123456790000000000000000000000',
            z: '2097152.2',
          },
        ];
        expect({
          text: await collect(driver.query({ sql: 'SELECT f, d, w, z FROM t ORDER BY id' })),
          prepared: await collect(
            driver.query({
              sql: 'SELECT f, d, w, z FROM t WHERE ?1 = ?1 ORDER BY id',
              params: [1],
            }),
          ),
        }).toEqual({ text: rows, prepared: rows });
      }),
    );
  });

  it('reads negative zero in a computed column declared with decimals with its sign, as MySQL writes it, whether the row came over the text protocol or prepared', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        await driver.execute({
          sql: 'CREATE TABLE t (f FLOAT(10,2), d DOUBLE(10,2), w DOUBLE(255,0))',
        });
        await driver.execute({ sql: 'INSERT INTO t VALUES (-1.5e0, 0e0, 0e0)' });
        const rows = [{ negated: '-0.00', times: '-0.00', whole: '-0' }];
        const select = 'SELECT -d AS negated, f * 0 AS times, -w AS whole FROM t';
        expect({
          text: await collect(driver.query({ sql: select })),
          prepared: await collect(driver.query({ sql: `${select} WHERE ?1 = ?1`, params: [1] })),
        }).toEqual({ text: rows, prepared: rows });
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
          const request = { sql: "SELECT ?1 AS v, 'x\\' AS a, ? AS b", params: [1] };
          await expect(collect(connection.query(request))).rejects.toMatchObject({
            code: 'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
            meta: expect.objectContaining({ prepared: 2, params: 1 }),
          });
          await expect(connection.execute(request)).rejects.toMatchObject({
            code: 'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
          });
        } finally {
          await connection.destroy();
        }
      }),
    );
  });

  it('keeps a SET on its connection after the connection goes back to the pool, as Postgres does', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      await withDriver(
        url,
        async (driver) => {
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
        },
        { poolOptions: { max: 1 }, sessionSettings: { time_zone: '+00:00' } },
      );
    });
  });

  it('reports a LIMIT value that is not an integer as the SqlQueryError MySQL raises', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        await expect(
          collect(
            driver.query({
              sql: 'SELECT 1 AS n FROM DUAL LIMIT ?1',
              params: [1.5],
            }),
          ),
        ).rejects.toMatchObject({ kind: 'sql_query', sqlState: 'HY000' });
      }),
    );
  });

  it('sets up every connection: no backslash escapes mode, and the session settings it is created with, an integer setting among them', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(
        url,
        async (driver) => {
          const read = () =>
            collect(
              driver.query<Record<string, string>>({
                sql: "SELECT @@SESSION.time_zone AS tz, @@SESSION.sql_select_limit AS sl, FIND_IN_SET('NO_BACKSLASH_ESCAPES', @@SESSION.sql_mode) AS nbe",
              }),
            );
          const held = await driver.acquireConnection();
          try {
            const [onHeld] = await collect(
              held.query<Record<string, string>>({ sql: 'SELECT @@SESSION.time_zone AS tz' }),
            );
            expect({ pooled: await read(), held: onHeld }).toEqual({
              pooled: [{ tz: '+03:00', sl: '7', nbe: '0' }],
              held: { tz: '+03:00' },
            });
          } finally {
            await held.release();
          }
        },
        { sessionSettings: { time_zone: '+03:00', sql_select_limit: '7' } },
      ),
    );
  });

  it('sends a session setting as a parameter, so a value with a quote stays one value, and reports a setting MySQL refuses at once, as a SqlQueryError', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(
        url,
        async (driver) => {
          const started = Date.now();
          const error = await driver
            .execute({ sql: 'SELECT 1' })
            .catch((thrown: unknown) => thrown);
          expect({
            error: Object(error),
            fast: Date.now() - started < 2000,
          }).toMatchObject({
            error: {
              kind: 'sql_query',
              sqlState: 'HY000',
              message: expect.stringContaining("time zone: '+00:00' , sql_mode = 'ANSI_QUOTES'"),
            },
            fast: true,
          });
        },
        { sessionSettings: { time_zone: "+00:00' , sql_mode = 'ANSI_QUOTES" } },
      ),
    );
  });

  it('leaves a connection usable after its caller stops reading a stream early', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(
        url,
        async (driver) => {
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
        },
        streaming,
      ),
    );
  });

  it('stops a pooled stream the caller breaks out of without reading the rest of the result', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(
        url,
        async (driver) => {
          const started = Date.now();
          for await (const _row of driver.query({ sql: slowRows })) break;
          const elapsedMs = Date.now() - started;
          expect({
            quick: elapsedMs < 3000,
            next: await collect(driver.query({ sql: 'SELECT 1 AS n' })),
          }).toEqual({ quick: true, next: [{ n: '1' }] });
        },
        streaming,
      ),
    );
  });

  it('returns a pooled connection whose stream the caller stops early to the pool when the whole result has arrived, opening no connection', async (test) => {
    await withMysqlDatabase(test, ({ url, name }) =>
      withCountedUser(url, name, async (userUrl, opened) => {
        await withDriver(
          userUrl.toString(),
          async (driver) => {
            const first = await connectionId(driver);
            const before = await opened();
            for (let round = 0; round < 10; round += 1) {
              for (const sql of [numbers, twoHundredNumbers]) {
                for await (const _row of driver.query({ sql })) break;
              }
            }
            expect({
              opened: (await opened()) - before,
              same: (await connectionId(driver)) === first,
            }).toEqual({
              opened: 0,
              same: true,
            });
          },
          single,
        );
      }),
    );
  });

  it('destroys a pooled connection whose stream the caller stops early while a large rest of the result is still to come', async (test) => {
    await withMysqlDatabase(test, ({ url, name }) =>
      withCountedUser(url, name, async (userUrl, opened) => {
        await withDriver(
          userUrl.toString(),
          async (driver) => {
            const first = await connectionId(driver);
            const before = await opened();
            for await (const _row of driver.query({ sql: slowRows })) break;
            const next = await connectionId(driver);
            expect({ opened: (await opened()) - before > 0, replaced: next !== first }).toEqual({
              opened: true,
              replaced: true,
            });
          },
          single,
        );
      }),
    );
  });

  it('runs a statement awaited inside the loop over a query on the same transaction, because a query reads its whole result first, as Postgres does without a cursor', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        await driver.execute({ sql: 'CREATE TABLE t (n INT)' });
        const connection = await driver.acquireConnection();
        const transaction = await connection.beginTransaction();
        const inserted: unknown[] = [];
        for await (const row of transaction.query<{ n: string }>({ sql: numbers })) {
          inserted.push(
            await transaction.execute({ sql: 'INSERT INTO t VALUES (?1)', params: [row.n] }),
          );
        }
        await transaction.commit();
        await connection.release();
        expect({
          inserted,
          after: await collect(driver.query({ sql: 'SELECT n FROM t ORDER BY n' })),
        }).toEqual({
          inserted: [{ affectedRows: 1 }, { affectedRows: 1 }, { affectedRows: 1 }],
          after: [{ n: '1' }, { n: '2' }, { n: '3' }],
        });
      }),
    );
  });

  it('runs a statement sent on a transaction while a stream on it is still arriving after the stream ends, and a commit sent after it after it, as the Postgres driver does with a cursor', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(
        url,
        async (driver) => {
          await driver.execute({ sql: 'CREATE TABLE t (n INT)' });
          const connection = await driver.acquireConnection();
          const transaction = await connection.beginTransaction();
          let lastRowAt = 0;
          let insertedAt = 0;
          let inserted: Promise<unknown> | undefined;
          let committed: Promise<void> | undefined;
          for await (const _row of transaction.query({ sql: tenSlowRows })) {
            lastRowAt = performance.now();
            inserted ??= transaction
              .execute({ sql: 'INSERT INTO t VALUES (?1)', params: [1] })
              .then((stats) => {
                insertedAt = performance.now();
                return stats;
              });
            committed ??= transaction.commit();
          }
          const stats = await inserted;
          await committed;
          await connection.release();
          expect({
            insertedAfterLastRow: insertedAt >= lastRowAt,
            stats,
            after: await collect(driver.query({ sql: 'SELECT n FROM t' })),
          }).toEqual({
            insertedAfterLastRow: true,
            stats: { affectedRows: 1 },
            after: [{ n: '1' }],
          });
        },
        streaming,
      ),
    );
  });

  it('runs statements on a transaction in the order they are sent, so a prepared statement sent before a rollback is rolled back', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver) => {
        await driver.execute({ sql: 'CREATE TABLE t (n INT)' });
        const connection = await driver.acquireConnection();
        try {
          const transaction = await connection.beginTransaction();
          await Promise.all([
            transaction.execute({ sql: 'INSERT INTO t VALUES (?1)', params: [1] }),
            transaction.rollback(),
          ]);
        } finally {
          await connection.release();
        }
        expect(await collect(driver.query({ sql: 'SELECT n FROM t' }))).toEqual([]);
      }),
    );
  });

  it('destroys a held connection released while a stream on it is still open, so the pool and close() go on', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = mysqlRuntimeDriver.create(single);
      await driver.connect({ kind: 'url', url });
      const connection = await driver.acquireConnection();
      const transaction = await connection.beginTransaction();
      const rows = transaction.query<{ cid: string }>({ sql: slowRows })[Symbol.asyncIterator]();
      const first = await rows.next();
      await connection.release();
      const [after] = await collect(
        driver.query<{ cid: string }>({ sql: 'SELECT CONNECTION_ID() AS cid' }),
      );
      await driver.close();
      expect({
        newConnection: after?.cid !== (first.done ? undefined : first.value.cid),
        state: driver.state,
      }).toEqual({ newConnection: true, state: 'closed' });
    });
  });

  it('fails a statement at once when MySQL refuses the sign-in or the account needs the server public key, and neither is transient, as on Postgres', async (test) => {
    await withMysqlDatabase(test, async ({ url, name }) => {
      const admin = await mysqlControlDriver.create(url);
      const user = `${name.slice(-12)}_s`;
      try {
        await admin.query(
          `CREATE USER '${user}'@'%' IDENTIFIED WITH caching_sha2_password BY 'pw-sign-in'`,
        );
        const failure = async (password: string, allowPublicKeyRetrieval: boolean) => {
          const asUser = new URL(url);
          asUser.username = user;
          asUser.password = password;
          asUser.searchParams.set('allowPublicKeyRetrieval', String(allowPublicKeyRetrieval));
          const started = Date.now();
          const error = await withDriver(
            asUser.toString(),
            (driver) => driver.execute({ sql: 'SELECT 1' }),
            { poolOptions: { connectionTimeoutMillis: 10_000 } },
          ).catch((thrown: unknown) => thrown);
          return { error: Object(error), fast: Date.now() - started < 3000 };
        };
        expect({
          publicKey: await failure('pw-sign-in', false),
          password: await failure('wrong', true),
        }).toMatchObject({
          publicKey: {
            error: { kind: 'sql_connection', transient: false },
            fast: true,
          },
          password: {
            error: { kind: 'sql_query', sqlState: '28000' },
            fast: true,
          },
        });
      } finally {
        await admin.query(`DROP USER IF EXISTS '${user}'@'%'`).catch(() => undefined);
        await admin.close();
      }
    });
  });

  it('runs a statement waiting for a pooled connection once one is free, when a statement on another connection fails with an error MySQL also refuses a sign-in with', async (test) => {
    await withMysqlDatabase(test, ({ url, name }) =>
      withDriver(
        url,
        async (driver) => {
          const user = `${name.slice(-12)}_p`;
          const held = await driver.acquireConnection();
          try {
            const sleeping = driver.execute({ sql: 'SELECT SLEEP(1)' });
            await new Promise((resolve) => setTimeout(resolve, 200));
            const waiting = collect(driver.query({ sql: 'SELECT 1 AS n' }));
            await new Promise((resolve) => setTimeout(resolve, 200));
            const failed = await held
              .execute({ sql: `CREATE USER '${user}'@'%' IDENTIFIED WITH no_such_plugin` })
              .catch((error: unknown) => error);
            expect({ failed, waiting: await waiting, slept: await sleeping }).toEqual({
              failed: expect.objectContaining({ kind: 'sql_query', sqlState: 'HY000' }),
              waiting: [{ n: '1' }],
              slept: { affectedRows: 0 },
            });
          } finally {
            await held.execute({ sql: `DROP USER IF EXISTS '${user}'@'%'` });
            await held.release();
          }
        },
        { poolOptions: { max: 2 } },
      ),
    );
  });

  it('fails a statement at once as not transient when the server refuses the connection, as on Postgres', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const closedPort = new URL(url);
      closedPort.hostname = '127.0.0.1';
      closedPort.port = '1';
      const started = Date.now();
      const error = await withDriver(
        closedPort.toString(),
        (driver) => driver.execute({ sql: 'SELECT 1' }),
        { poolOptions: { connectionTimeoutMillis: 10_000 } },
      ).catch((thrown: unknown) => thrown);
      expect({ error, fast: Date.now() - started < 3000 }).toEqual({
        error: expect.objectContaining({ kind: 'sql_connection', transient: false }),
        fast: true,
      });
    });
  });

  it('runs a statement once the server accepts connections again, after an earlier statement failed because it refused them, as pg.Pool tries each connect afresh', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const server = new URL(url);
      const port = await freePort();
      const refusing = new URL(url);
      refusing.hostname = '127.0.0.1';
      refusing.port = String(port);
      const proxy = createServer((client) => {
        const upstream = connect(Number(server.port), server.hostname);
        client.pipe(upstream).pipe(client);
        client.on('error', () => upstream.destroy());
        upstream.on('error', () => client.destroy());
      });
      try {
        const outcomes = await withDriver(
          refusing.toString(),
          async (driver) => {
            const refused = await driver
              .execute({ sql: 'SELECT 1' })
              .catch((error: unknown) => error);
            await new Promise((resolve) => setTimeout(resolve, 700));
            await new Promise<void>((resolve) => proxy.listen(port, '127.0.0.1', resolve));
            const afterReturn = await collect(driver.query({ sql: 'SELECT 2 AS n' }));
            return { refused, afterReturn };
          },
          { poolOptions: { connectionTimeoutMillis: 500 } },
        );
        expect(outcomes).toEqual({
          refused: expect.objectContaining({ kind: 'sql_connection', transient: false }),
          afterReturn: [{ n: '2' }],
        });
      } finally {
        await new Promise((resolve) => proxy.close(resolve));
      }
    });
  });

  it('returns each connection the pool hands to a statement that already failed straight to the pool, so the pool serves every such request and then runs the next statement on its one connection', async (test) => {
    await withMysqlDatabase(test, ({ url, name }) =>
      withCountedUser(url, name, async (userUrl, opened) => {
        const port = await freePort();
        const refusing = new URL(userUrl);
        refusing.hostname = '127.0.0.1';
        refusing.port = String(port);
        const proxy = createServer((client) => {
          const upstream = connect(Number(userUrl.port), userUrl.hostname);
          client.pipe(upstream).pipe(client);
          client.on('error', () => upstream.destroy());
          upstream.on('error', () => client.destroy());
        });
        try {
          const before = await opened();
          const outcomes = await withDriver(
            refusing.toString(),
            async (driver) => {
              const refused = await Promise.all(
                Array.from({ length: 5 }, (_, n) =>
                  driver.execute({ sql: `SELECT ${n}` }).catch((error: unknown) => error),
                ),
              );
              await new Promise<void>((resolve) => proxy.listen(port, '127.0.0.1', resolve));
              const started = Date.now();
              const afterReturn = await collect(driver.query({ sql: 'SELECT 2 AS n' }));
              const waited = Date.now() - started;
              const next = await collect(driver.query({ sql: 'SELECT 3 AS n' }));
              return { refused, afterReturn, next, beforeTimeout: waited < 2000 };
            },
            { poolOptions: { max: 1, connectionTimeoutMillis: 2500 } },
          );
          expect({ ...outcomes, opened: (await opened()) - before }).toEqual({
            refused: Array.from({ length: 5 }, () =>
              expect.objectContaining({ kind: 'sql_connection', transient: false }),
            ),
            afterReturn: [{ n: '2' }],
            next: [{ n: '3' }],
            beforeTimeout: true,
            opened: 1,
          });
        } finally {
          await new Promise((resolve) => proxy.close(resolve));
        }
      }),
    );
  });

  it('gives up waiting for a pooled connection after connectionTimeoutMillis', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(
        url,
        async (driver) => {
          const held = await driver.acquireConnection();
          const waiting = collect(driver.query({ sql: 'SELECT 1 AS n' }));
          await expect(waiting).rejects.toMatchObject({ kind: 'sql_connection', transient: true });
          await held.release();
          expect(await collect(driver.query({ sql: 'SELECT 2 AS n' }))).toEqual([{ n: '2' }]);
        },
        { poolOptions: { max: 1, connectionTimeoutMillis: 200 } },
      ),
    );
  });

  it('opens no connection before the first statement needs one, as pg.Pool does', async (test) => {
    await withMysqlDatabase(test, ({ url, name }) =>
      withCountedUser(url, name, async (userUrl, opened) => {
        const before = await opened();
        await withDriver(userUrl.toString(), async (driver) => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          const atConnect = (await opened()) - before;
          await collect(driver.query({ sql: 'SELECT 1 AS n' }));
          expect({ atConnect, afterOne: (await opened()) - before }).toEqual({
            atConnect: 0,
            afterOne: 1,
          });
        });
      }),
    );
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
          }).toEqual({ stats: { affectedRows: 2 }, rows: [{ id: '3' }, { id: '4' }] });
        } finally {
          await connection.release();
        }
      }),
    );
  });

  it('waits in close() for a stream in flight to finish', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = mysqlRuntimeDriver.create(streaming);
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

  it('ends a stream whose connection is lost with a transient SqlConnectionError, and close() still finishes', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const admin = await mysqlControlDriver.create(url);
      const driver = mysqlRuntimeDriver.create(streaming);
      await driver.connect({ kind: 'url', url });
      try {
        const rows = driver.query<{ cid: string }>({ sql: slowRows })[Symbol.asyncIterator]();
        const first = await rows.next();
        await admin.query(`KILL ${first.done ? '' : first.value.cid}`);
        await expect(drain(rows)).rejects.toMatchObject({
          kind: 'sql_connection',
          transient: true,
        });
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
      const driver = mysqlRuntimeDriver.create(streaming);
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

  it('leaves the values of a statement MySQL refuses when it runs out of its error, from a stream, from a whole result and from execute', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const value = 'distinctive-value-5d1c9e';
      const request = { sql: 'INSERT INTO t VALUES (?1)', params: [value] };
      const errors = async (driver: ReturnType<typeof mysqlRuntimeDriver.create>) => [
        await collect(driver.query(request)).catch((error: unknown) => error),
        await driver.execute(request).catch((error: unknown) => error),
      ];
      await withDriver(url, (driver) =>
        driver.execute({ sql: "CREATE TABLE t (s VARCHAR(40), CHECK (s = 'allowed'))" }),
      );
      const all = [
        ...(await withDriver(url, errors, streaming)),
        ...(await withDriver(url, errors)),
      ];
      expect(
        all.map((error) => ({
          sqlState: Object(error).sqlState,
          leaked: inspect(error, { depth: 10 }).includes(value),
        })),
      ).toEqual(Array.from({ length: 4 }, () => ({ sqlState: '23514', leaked: false })));
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
