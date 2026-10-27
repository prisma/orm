import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pgConnectionConfig } from '../src/session-settings';

const SETTINGS = { DateStyle: 'ISO' } as const;

function fromUrl(url: string) {
  return pgConnectionConfig({ connectionString: url }, SETTINGS);
}

const CONNECTION_FIELDS = [
  'user',
  'password',
  'database',
  'port',
  'host',
  'binary',
  'options',
  'ssl',
  'sslnegotiation',
  'client_encoding',
  'replication',
  'isDomainSocket',
  'application_name',
  'fallback_application_name',
  'statement_timeout',
  'lock_timeout',
  'idle_in_transaction_session_timeout',
  'query_timeout',
  'connect_timeout',
  'keepalives',
  'keepalives_idle',
] as const;

/** What a pg client connects with, apart from its startup options. */
function connectsWith(client: pg.Client): Record<string, unknown> {
  const parameters: unknown = Reflect.get(client, 'connectionParameters');
  return Object.fromEntries(
    CONNECTION_FIELDS.filter((field) => field !== 'options').map((field) => [
      field,
      Reflect.get(Object(parameters), field),
    ]),
  );
}

const certificate = `${mkdtempSync(`${tmpdir()}/iso-date-style-`)}/c.pem`;
writeFileSync(certificate, 'not a real certificate');

const URLS = [
  'postgres://u:p@localhost:5432/db',
  'postgresql://u:p%40ss%2Fw%3Ard@db.example.com/db',
  'postgres://u:p@localhost/db?sslmode=require',
  `postgres://u:p@localhost/db?sslmode=verify-full&sslrootcert=${certificate}&sslcert=${certificate}&sslkey=${certificate}`,
  'postgres://u:p@localhost/db?sslmode=disable',
  'postgres://u:p@localhost/db?sslmode=no-verify',
  'postgres://u:p@localhost/db?ssl=true',
  'postgres://u:p@localhost/db?ssl=no-verify',
  'postgres://u:p@localhost/db?uselibpqcompat=true&sslmode=require',
  'postgres://u:p@localhost/db?options=-c%20search_path%3Dfoo',
  'postgres://u:p@localhost/db?application_name=myapp&connect_timeout=7&statement_timeout=1000&keepalives=1',
  'postgres://u:p@/db?host=/var/run/postgresql',
  'postgres://u:p@%2Fvar%2Frun%2Fpostgresql/db',
  'socket://u:p@/var/run/postgresql?db=db&encoding=utf8',
  '/var/run/postgresql db',
  'postgres://u:p@[::1]:5433/db',
  'postgres://u:p@[2001:db8::1]/db',
  'postgres://u@localhost/db',
  'postgres://localhost',
  'postgres://u:p@localhost/db?schema=public&connection_limit=5',
  'postgres://u:p@localhost/db?replication=database',
  'postgres://u:p@localhost/db?client_encoding=LATIN1&fallback_application_name=x',
  'postgres://u:p@localhost/db?sslnegotiation=direct&sslmode=require',
  'postgres://u:p@localhost/db?port=6000',
  'postgres://u:p@localhost/db?statement_timeout=1000&query_timeout=2000&lock_timeout=3000&idle_in_transaction_session_timeout=4000',
];

describe('a pg client built from the settings of a URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(URLS)('connects as pg does from the connection string %s', (url) => {
    expect(connectsWith(new pg.Client(fromUrl(url)))).toEqual(
      connectsWith(new pg.Client({ connectionString: url })),
    );
  });

  it.each(URLS)(
    'connects as pg does from the connection string %s when PGSSLMODE and PGAPPNAME are set',
    (url) => {
      vi.stubEnv('PGSSLMODE', 'require');
      vi.stubEnv('PGAPPNAME', 'envapp');
      expect(connectsWith(new pg.Client(fromUrl(url)))).toEqual(
        connectsWith(new pg.Client({ connectionString: url })),
      );
    },
  );

  it('keeps TLS on without certificate checks for ssl=no-verify', () => {
    const client = new pg.Client(fromUrl('postgres://u:p@localhost/db?ssl=no-verify'));
    expect(Reflect.get(client, 'ssl')).toEqual({ rejectUnauthorized: false });
  });

  it.each(['true', 'false'])('reads text rows when the URL says binary=%s', (binary) => {
    const client = new pg.Client(fromUrl(`postgres://u:p@localhost/db?binary=${binary}`));
    expect(Reflect.get(client, 'binary')).toBe(false);
  });
});

describe('the connection settings of a connection Prisma opens', () => {
  it('send each session setting as a startup option, escaping spaces and backslashes', () => {
    expect(
      pgConnectionConfig(
        { connectionString: 'postgres://db.example.com/app' },
        { DateStyle: 'ISO', search_path: 'my schema', application_name: 'a\\b' },
      ).options,
    ).toBe('-c DateStyle=ISO -c search_path=my\\ schema -c application_name=a\\\\b');
  });

  it('add the session settings to a connection given without a connection string', () => {
    expect(pgConnectionConfig({ host: 'db.example.com', database: 'app' }, SETTINGS)).toEqual({
      host: 'db.example.com',
      database: 'app',
      options: '-c DateStyle=ISO',
    });
  });

  it('keep the settings given beside the connection string', () => {
    expect(
      pgConnectionConfig(
        { connectionString: 'postgres://db.example.com/app', connectionTimeoutMillis: 5 },
        SETTINGS,
      ).connectionTimeoutMillis,
    ).toBe(5);
  });

  it('add no startup options when the target declares no settings', () => {
    expect(
      pgConnectionConfig({ connectionString: 'postgres://db.example.com/app' }, {}).options,
    ).toBeUndefined();
  });

  it('set DateStyle=ISO as a startup option', () => {
    expect(
      fromUrl('postgres://someone:secret@db.example.com:6543/app?application_name=reports').options,
    ).toBe('-c DateStyle=ISO');
  });

  it('add DateStyle=ISO after the startup options the URL gives, so it wins over a DateStyle there', () => {
    expect(
      fromUrl(
        'postgres://db.example.com/app?options=-c%20search_path%3Dreports%20-c%20DateStyle%3DGerman',
      ).options,
    ).toBe('-c search_path=reports -c DateStyle=German -c DateStyle=ISO');
  });

  describe('with PGOPTIONS set', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('add DateStyle=ISO after PGOPTIONS when the URL gives no options, as pg reads PGOPTIONS then', () => {
      vi.stubEnv('PGOPTIONS', '-c search_path=reports');

      expect(fromUrl('postgres://db.example.com/app').options).toBe(
        '-c search_path=reports -c DateStyle=ISO',
      );
    });

    it('add DateStyle=ISO after the URL options, which pg reads in place of PGOPTIONS', () => {
      vi.stubEnv('PGOPTIONS', '-c search_path=reports');

      expect(fromUrl('postgres://db.example.com/app?options=-c%20work_mem%3D64MB').options).toBe(
        '-c work_mem=64MB -c DateStyle=ISO',
      );
    });
  });

  it('pass on only the connection settings pg reads from a URL, so a query parameter cannot set up the pool or the socket', () => {
    const config = fromUrl(
      'postgres://db.example.com/app?max=3&keepAlive=false&idleTimeoutMillis=1',
    );
    const pool = new pg.Pool(config);

    expect({
      keys: ['max', 'keepAlive', 'idleTimeoutMillis'].filter((key) => Object.hasOwn(config, key)),
      max: pool.options.max,
      idleTimeoutMillis: pool.options.idleTimeoutMillis,
    }).toEqual({
      keys: [],
      max: new pg.Pool().options.max,
      idleTimeoutMillis: new pg.Pool().options.idleTimeoutMillis,
    });
  });
});
