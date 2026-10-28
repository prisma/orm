import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { mysqlConnectionOptions, mysqlPoolOptions } from '../src/core/connection-options';
import { SESSION_SETUP } from '../src/core/session-setup';
import { readTextOrBytes } from '../src/core/text-or-bytes';

describe('mysqlConnectionOptions', () => {
  it('reads the server, credentials, database and TLS settings from the URL', () => {
    expect(
      mysqlConnectionOptions(
        'mysql://app:p%40ss@db.example:3307/shop?ssl={"rejectUnauthorized":false,"ca":"PEM"}',
      ),
    ).toMatchObject({
      host: 'db.example',
      port: 3307,
      user: 'app',
      password: 'p@ss',
      database: 'shop',
      ssl: { rejectUnauthorized: false, ca: 'PEM' },
    });
    expect(mysqlConnectionOptions('mysql://root@localhost/app?ssl=true')).toMatchObject({
      ssl: true,
    });
  });

  it('reads an IPv6 host without its brackets', () => {
    expect(mysqlConnectionOptions('mysql://root@[::1]:3306/app')).toMatchObject({ host: '::1' });
  });

  it('leaves the port to the package when the URL names none', () => {
    expect(mysqlConnectionOptions('mysql://root@localhost/app')).not.toHaveProperty('port');
  });

  it('sets up each connection with the session statements, in utf8mb4, and never logs values', () => {
    expect(mysqlConnectionOptions('mysql://root@localhost/app')).toMatchObject({
      collation: 'UTF8MB4_UNICODE_CI',
      initSql: [...SESSION_SETUP],
      logParam: false,
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

  it('keeps the prepared-statement cache off unless statementCacheSize turns it on', () => {
    expect({
      off: mysqlConnectionOptions('mysql://root@localhost/app').prepareCacheLength,
      zero: mysqlConnectionOptions('mysql://root@localhost/app?statementCacheSize=0')
        .prepareCacheLength,
      on: mysqlConnectionOptions('mysql://root@localhost/app?statementCacheSize=20')
        .prepareCacheLength,
    }).toEqual({ off: 0, zero: 0, on: 20 });
  });

  it('refuses a statementCacheSize that is not a non-negative integer', () => {
    for (const size of ['-1', '1.5', 'many', '']) {
      expect(() =>
        mysqlConnectionOptions(`mysql://root@localhost/app?statementCacheSize=${size}`),
      ).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.BINDING_INVALID',
          message: expect.stringContaining('statementCacheSize'),
        }),
      );
    }
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
    for (const ssl of ['{"secureProtocol":"TLSv1_method"}', 'maybe', '1']) {
      expect(() => mysqlConnectionOptions(`mysql://root@localhost/app?ssl=${ssl}`)).toThrow(
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

  it('refuses a URL parameter the driver does not understand', () => {
    for (const parameter of [
      'namedPlaceholders=true',
      'multipleStatements=true',
      'permitSetMultiParamEntries=true',
      'typeCast=false',
      'flags=MULTI_STATEMENTS',
      'prepareCacheLength=10',
    ]) {
      expect(() => mysqlConnectionOptions(`mysql://root@localhost/app?${parameter}`)).toThrow(
        expect.objectContaining({ code: 'RUNTIME.BINDING_INVALID' }),
      );
    }
  });

  it('names the parameters it accepts when it refuses one, and the replacement for each Prisma 7 engine parameter', () => {
    const accepted =
      'it accepts ssl, connectTimeout, allowPublicKeyRetrieval, connectionLimit, poolTimeout and statementCacheSize';
    const replacements = {
      connection_limit: 'use connectionLimit',
      pool_timeout: 'use poolTimeout, in milliseconds',
      connect_timeout: 'use connectTimeout, in milliseconds',
      sslcert: "use ssl, with the CA certificate's PEM text as ca",
      sslidentity: "use ssl, with the client certificate's and key's PEM text as cert and key",
      sslpassword: "use ssl's passphrase",
      sslaccept: "use ssl's rejectUnauthorized",
      socket_timeout: 'no replacement',
      statement_cache_size: 'use statementCacheSize',
    };
    for (const [parameter, replacement] of Object.entries(replacements)) {
      expect(() => mysqlConnectionOptions(`mysql://root@localhost/app?${parameter}=1`)).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.BINDING_INVALID',
          message: expect.stringContaining(`${parameter} (${replacement}); ${accepted}`),
          meta: { received: parameter, reason: expect.any(String) },
        }),
      );
    }
    expect(() =>
      mysqlConnectionOptions('mysql://root@localhost/app?flags=X&connection_limit=2'),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          `flags, connection_limit (use connectionLimit); ${accepted}`,
        ),
        meta: { received: 'flags, connection_limit', reason: expect.any(String) },
      }),
    );
  });

  it('names a parameter whose value it refuses, and the form the value must take', () => {
    expect(() =>
      mysqlPoolOptions('mysql://root@localhost/app?poolTimeout=soon&connectionLimit=2'),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.BINDING_INVALID',
        message: expect.stringContaining('poolTimeout must be a positive integer of milliseconds'),
        meta: { received: 'poolTimeout', reason: expect.any(String) },
      }),
    );
  });

  it('copies no value from the URL into the error, neither the password nor a TLS key, even from a URL it cannot parse', () => {
    const secrets = ['hunter2-secret', 'PRIVATE-KEY-PEM', 'pp-secret'];
    const ssl = encodeURIComponent(
      JSON.stringify({ key: 'PRIVATE-KEY-PEM', passphrase: 'pp-secret', bogus: 1 }),
    );
    const validSsl = encodeURIComponent(
      JSON.stringify({ key: 'PRIVATE-KEY-PEM', passphrase: 'pp-secret' }),
    );
    for (const url of [
      `mysql://app:hunter2-secret@db.example/app?ssl=${ssl}`,
      `mysql://app:hunter2-secret@db.example/app?ssl=${validSsl}&connection_limit=hunter2-secret`,
      `mysql://app:hunter2-secret@db.example/app?ssl=${validSsl}&poolTimeout=hunter2-secret`,
      `mysql://app:hunter2-secret@db.example/app?ssl=${validSsl}&charset=hunter2-secret`,
      'mysql://app:hunter2-secret@[db.example/app',
    ]) {
      const error = (() => {
        try {
          mysqlPoolOptions(url);
        } catch (thrown) {
          return thrown;
        }
        throw new Error(`accepted ${url}`);
      })();
      const written = inspect(error, { depth: 10 });
      expect({
        code: Object(error).code,
        leaked: secrets.filter((secret) => written.includes(secret)),
      }).toEqual({ code: 'RUNTIME.BINDING_INVALID', leaked: [] });
    }
  });

  it('waits ten seconds to connect unless the URL or the caller says otherwise, and leaves out the pool settings', () => {
    const given = mysqlConnectionOptions(
      'mysql://root@localhost/app?connectionLimit=2&poolTimeout=100&connectTimeout=300',
      500,
    );
    expect({
      default: mysqlConnectionOptions('mysql://root@localhost/app').connectTimeout,
      url: mysqlConnectionOptions('mysql://root@localhost/app?connectTimeout=300').connectTimeout,
      caller: given.connectTimeout,
      poolSettings: 'connectionLimit' in given || 'acquireTimeout' in given,
    }).toEqual({ default: 10_000, url: 300, caller: 500, poolSettings: false });
  });
});

describe('mysqlPoolOptions', () => {
  it('reads the pool size and how long to wait for a connection, waiting ten seconds by default', () => {
    expect({
      given: mysqlPoolOptions(
        'mysql://root@localhost/app?connectionLimit=5&poolTimeout=2000&statementCacheSize=20',
      ),
      defaults: mysqlPoolOptions('mysql://root@localhost/app?ssl=true'),
    }).toMatchObject({
      given: { connectionLimit: 5, acquireTimeout: 2000, prepareCacheLength: 20 },
      defaults: { acquireTimeout: 10_000, prepareCacheLength: 0, ssl: true },
    });
    expect(mysqlPoolOptions('mysql://root@localhost/app')).not.toHaveProperty('connectionLimit');
  });

  it('refuses a pool setting that is not a positive integer', () => {
    for (const parameter of ['connectionLimit=0', 'poolTimeout=soon', 'connectionLimit=2.5']) {
      expect(() => mysqlPoolOptions(`mysql://root@localhost/app?${parameter}`)).toThrow(
        expect.objectContaining({ code: 'RUNTIME.BINDING_INVALID' }),
      );
    }
  });
});
