import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { mysqlConnectionOptions, mysqlPoolOptions } from '../src/core/connection-options';
import { SESSION_SETUP } from '../src/core/session-setup';
import { readTextOrBytes } from '../src/core/text-or-bytes';

describe('mysqlConnectionOptions', () => {
  it('reads the server, credentials and database from the URL', () => {
    expect(mysqlConnectionOptions('mysql://app:p%40ss@db.example:3307/shop')).toMatchObject({
      host: 'db.example',
      port: 3307,
      user: 'app',
      password: 'p@ss',
      database: 'shop',
    });
  });

  it('reads TLS settings as pg-connection-string does for Postgres: ssl, sslmode, and sslcert, sslkey and sslrootcert as PEM files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mysql-tls-'));
    const file = (name: string) => {
      const path = join(dir, name);
      writeFileSync(path, `${name} PEM`);
      return encodeURIComponent(path);
    };
    const ssl = (query: string) =>
      mysqlConnectionOptions(`mysql://root@localhost/app?${query}`).ssl;
    try {
      expect({
        none: ssl('allowPublicKeyRetrieval=false'),
        on: ssl('ssl=true'),
        one: ssl('ssl=1'),
        off: ssl('ssl=0'),
        verifyFull: ssl('sslmode=verify-full'),
        require: ssl('sslmode=require'),
        noVerify: ssl('sslmode=no-verify'),
        disable: ssl(`sslmode=disable&sslrootcert=${file('ca')}`),
        files: ssl(`sslcert=${file('cert')}&sslkey=${file('key')}&sslrootcert=${file('ca')}`),
      }).toEqual({
        none: undefined,
        on: true,
        one: true,
        off: false,
        verifyFull: {},
        require: {},
        noVerify: { rejectUnauthorized: false },
        disable: false,
        files: { cert: 'cert PEM', key: 'key PEM', ca: 'ca PEM' },
      });
      expect(() => ssl('sslkey=/no/such/file.pem')).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.BINDING_INVALID',
          message: expect.stringContaining('the file sslkey names cannot be read'),
          meta: { received: 'sslkey', reason: expect.any(String) },
        }),
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('reads an IPv6 host without its brackets', () => {
    expect(mysqlConnectionOptions('mysql://root@[::1]:3306/app')).toMatchObject({ host: '::1' });
  });

  it('leaves the port to the package when the URL names none', () => {
    expect(mysqlConnectionOptions('mysql://root@localhost/app')).not.toHaveProperty('port');
  });

  it('sets up each connection with the session statements alone, in utf8mb4, never logs values, never caches statements and counts matched rows', () => {
    expect(mysqlConnectionOptions('mysql://root@localhost/app').initSql).toEqual([
      ...SESSION_SETUP,
    ]);
    expect(mysqlConnectionOptions('mysql://root@localhost/app')).toMatchObject({
      collation: 'UTF8MB4_UNICODE_CI',
      prepareCacheLength: 0,
      foundRows: true,
      logParam: false,
      permitRedirect: false,
      multipleStatements: false,
      namedPlaceholders: false,
      permitSetMultiParamEntries: false,
      permitLocalInfile: false,
    });
  });

  it('reads every column as text or bytes, on the pool and on a single connection', () => {
    expect({
      connection: mysqlConnectionOptions('mysql://root@localhost/app').typeCast,
      pool: mysqlPoolOptions('mysql://root@localhost/app').typeCast,
    }).toEqual({ connection: readTextOrBytes, pool: readTextOrBytes });
  });

  it('fetches the server public key only when allowPublicKeyRetrieval=true', () => {
    expect({
      default: mysqlConnectionOptions('mysql://root@localhost/app').allowPublicKeyRetrieval,
      on: mysqlConnectionOptions('mysql://root@localhost/app?allowPublicKeyRetrieval=true')
        .allowPublicKeyRetrieval,
      off: mysqlConnectionOptions('mysql://root@localhost/app?allowPublicKeyRetrieval=false')
        .allowPublicKeyRetrieval,
    }).toEqual({ default: false, on: true, off: false });
    expect(() =>
      mysqlConnectionOptions('mysql://root@localhost/app?allowPublicKeyRetrieval=yes'),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME.BINDING_INVALID' }));
  });

  it('refuses TLS settings it does not know', () => {
    for (const query of ['ssl={}', 'ssl=maybe', 'sslmode=allow', 'sslcert=']) {
      expect(() => mysqlConnectionOptions(`mysql://root@localhost/app?${query}`)).toThrow(
        expect.objectContaining({ code: 'RUNTIME.BINDING_INVALID' }),
      );
    }
  });

  it('always connects as utf8mb4, and refuses a charset in the URL', () => {
    for (const charset of ['latin1', 'utf8mb4']) {
      expect(() => mysqlConnectionOptions(`mysql://root@localhost/app?charset=${charset}`)).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.BINDING_INVALID',
          message: expect.stringContaining('always uses utf8mb4'),
        }),
      );
    }
  });

  it('ignores a URL parameter it does not read, as pg ignores one, so the URL cannot turn on a package option', () => {
    const plain = mysqlPoolOptions('mysql://root@localhost/app?sslmode=require');
    for (const parameter of [
      'multipleStatements=true',
      'namedPlaceholders=true',
      'permitSetMultiParamEntries=true',
      'permitLocalInfile=true',
      'permitRedirect=true',
      'typeCast=false',
      'prepareCacheLength=10',
      'connection_limit=2',
      'sslaccept=accept_invalid_certs',
    ]) {
      expect(mysqlPoolOptions(`mysql://root@localhost/app?sslmode=require&${parameter}`)).toEqual(
        plain,
      );
    }
  });

  it("refuses sslcert without sslkey, because a Prisma 7 MySQL URL's sslcert named the server's CA, which is now sslrootcert", () => {
    expect(() => mysqlConnectionOptions('mysql://root@localhost/app?sslcert=/etc/ca.pem')).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.BINDING_INVALID',
        message: expect.stringContaining(
          "sslcert names the client's certificate and needs sslkey; to check the server's certificate against a CA file, as sslcert did in Prisma 7, use sslrootcert",
        ),
        meta: { received: 'sslcert', reason: expect.any(String) },
      }),
    );
  });

  it('names a parameter whose value it refuses, and the form the value must take', () => {
    expect(() =>
      mysqlPoolOptions('mysql://root@localhost/app?sslmode=soon&allowPublicKeyRetrieval=true'),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.BINDING_INVALID',
        message: expect.stringContaining(
          'sslmode must be disable, prefer, require, verify-ca, verify-full or no-verify',
        ),
        meta: { received: 'sslmode', reason: expect.any(String) },
      }),
    );
  });

  it('copies no value from the URL into the error, not the password, even from a URL it cannot parse', () => {
    const secret = 'hunter2-secret';
    for (const url of [
      `mysql://app:${secret}@db.example/app?sslmode=${secret}`,
      `mysql://app:${secret}@db.example/app?sslcert=/${secret}.pem`,
      `mysql://app:${secret}@db.example/app?sslkey=/${secret}.pem`,
      `mysql://app:${secret}@db.example/app?charset=${secret}`,
      `mysql://app:${secret}@[db.example/app`,
    ]) {
      const error = (() => {
        try {
          mysqlPoolOptions(url);
        } catch (thrown) {
          return thrown;
        }
        throw new Error(`accepted ${url}`);
      })();
      expect({
        code: Object(error).code,
        leaked: inspect(error, { depth: 10 }).includes(secret),
      }).toEqual({ code: 'RUNTIME.BINDING_INVALID', leaked: false });
    }
  });

  it('waits 20 seconds to connect, as the Postgres facade does, unless the caller says otherwise, and leaves out the pool settings', () => {
    const given = mysqlConnectionOptions('mysql://root@localhost/app', { connectTimeoutMs: 500 });
    expect({
      default: mysqlConnectionOptions('mysql://root@localhost/app').connectTimeout,
      caller: given.connectTimeout,
      poolSettings: 'connectionLimit' in given || 'acquireTimeout' in given,
    }).toEqual({ default: 20_000, caller: 500, poolSettings: false });
  });
});

describe('mysqlPoolOptions', () => {
  it("sizes and times the pool as the Postgres driver's pg.Pool: no connection opened before one is needed, idle ones closed after 30 seconds, 20 seconds to wait for one", () => {
    expect({
      defaults: mysqlPoolOptions('mysql://root@localhost/app?ssl=true'),
      given: mysqlPoolOptions('mysql://root@localhost/app', {
        connectionTimeoutMillis: 2000,
        idleTimeoutMillis: 1500,
        max: 5,
      }),
    }).toMatchObject({
      defaults: {
        minimumIdle: 0,
        idleTimeout: 30,
        acquireTimeout: 20_000,
        connectTimeout: 20_000,
        prepareCacheLength: 0,
        ssl: true,
      },
      given: {
        minimumIdle: 0,
        idleTimeout: 2,
        acquireTimeout: 2000,
        connectTimeout: 2000,
        connectionLimit: 5,
        initSql: [...SESSION_SETUP],
      },
    });
    expect(mysqlPoolOptions('mysql://root@localhost/app')).not.toHaveProperty('connectionLimit');
  });
});
