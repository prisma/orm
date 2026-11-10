import type { SessionSettings } from '@internal/framework-components/components';
import { Client, type ClientBase, type ClientConfig, Pool, type PoolConfig } from 'pg';
import { parse } from 'pg-connection-string';

/** The settings pg's `ConnectionParameters` reads from a parsed connection string, except `binary`, which a pg client also applies to every query when it is in the client's own settings. Any other query parameter is not a connection setting, and pg ignores it in a connection string. */
const CONNECTION_SETTINGS = [
  'user',
  'password',
  'host',
  'port',
  'database',
  'options',
  'ssl',
  'sslnegotiation',
  'client_encoding',
  'replication',
  'application_name',
  'fallback_application_name',
  'statement_timeout',
  'lock_timeout',
  'idle_in_transaction_session_timeout',
  'query_timeout',
] as const;

function startupOptions(sessionSettings: SessionSettings): string {
  return Object.entries(sessionSettings)
    .map(([name, value]) => `-c ${name}=${value.replace(/[\\ ]/g, '\\$&')}`)
    .join(' ');
}

/**
 * The pg settings of a connection that starts with `sessionSettings`: the connection settings `config` gives, its connection string read as pg reads it, and each session setting as a startup option after the options the connection string gives, or else after `PGOPTIONS`, which is where pg reads them from. A startup option sets the session's default, so `RESET ALL` keeps it.
 */
export function pgConnectionConfig(
  config: ClientConfig,
  sessionSettings: SessionSettings,
): ClientConfig {
  const { connectionString, ...rest } = config;
  const merged: ClientConfig = { ...rest };
  if (connectionString !== undefined) {
    const parsed = parse(connectionString);
    for (const setting of CONNECTION_SETTINGS) {
      const value: unknown = Reflect.get(parsed, setting);
      if (value !== undefined) Object.assign(merged, { [setting]: value });
    }
  }
  const startup = startupOptions(sessionSettings);
  if (startup === '') return merged;
  const given = merged.options || process.env['PGOPTIONS'];
  merged.options = given ? `${given} ${startup}` : startup;
  return merged;
}

/** The pools and clients made by `createPgPool` and `createPgClient`, with the settings their sessions start with. */
const startupSettingsOf = new WeakMap<object, SessionSettings>();

/** A pg client class whose every client starts its session with `sessionSettings`. It reads its connection string, and `PGOPTIONS`, when each client is made, as pg does. */
function clientClassStartingWith(sessionSettings: SessionSettings): typeof Client {
  return class SessionSettingsClient extends Client {
    constructor(config?: ClientConfig) {
      super(pgConnectionConfig({ ...config }, sessionSettings));
    }
  };
}

/** A pg pool whose connections start their sessions with `sessionSettings`. */
export function createPgPool(config: PoolConfig, sessionSettings: SessionSettings): Pool {
  const pool = new Pool({ ...config, Client: clientClassStartingWith(sessionSettings) });
  startupSettingsOf.set(pool, sessionSettings);
  return pool;
}

/** A pg client whose session starts with `sessionSettings`. */
export function createPgClient(config: ClientConfig, sessionSettings: SessionSettings): Client {
  const SessionSettingsClient = clientClassStartingWith(sessionSettings);
  const client = new SessionSettingsClient(config);
  startupSettingsOf.set(client, sessionSettings);
  return client;
}

function startsWith(poolOrClient: object, sessionSettings: SessionSettings): boolean {
  const atStartup = startupSettingsOf.get(poolOrClient);
  return (
    atStartup !== undefined &&
    Object.entries(sessionSettings).every(([name, value]) => atStartup[name] === value)
  );
}

/**
 * Ensures the session settings a target declares on each pg client a driver uses from `poolOrClient`. A pool or client made by `createPgPool` or `createPgClient` with the settings needs nothing, because each session starts with them and `RESET ALL` keeps a startup setting. On any other, each client is set once, and again after it was handed out for exclusive use, whose holder may have changed or reset its session.
 */
export class SessionSettingsGuard {
  readonly #entries: readonly (readonly [string, string])[];
  readonly #ensured = new WeakSet<ClientBase>();

  constructor(sessionSettings: SessionSettings, poolOrClient: object) {
    this.#entries = startsWith(poolOrClient, sessionSettings)
      ? []
      : Object.entries(sessionSettings);
  }

  needs(client: ClientBase): boolean {
    return this.#entries.length > 0 && !this.#ensured.has(client);
  }

  /** Sets the settings on a client that {@link SessionSettingsGuard.needs} them. */
  async ensure(client: ClientBase): Promise<void> {
    const calls = this.#entries.map(
      (_, index) => `set_config($${index * 2 + 1}, $${index * 2 + 2}, false)`,
    );
    await client.query(`SELECT ${calls.join(', ')}`, this.#entries.flat());
    this.#ensured.add(client);
  }

  /** Marks a client returned from exclusive use, so its settings are ensured again before the driver next uses it. */
  forget(client: ClientBase): void {
    this.#ensured.delete(client);
  }
}
