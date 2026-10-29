import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTelemetryDb, type TelemetryDb } from '../src/db';
import { createHandler, MAX_EVENT_BODY_BYTES } from '../src/handler';
import { MAX_TELEMETRY_ARRAY_ITEM_LENGTH, MAX_TELEMETRY_STRING_LENGTH } from '../src/schema';
import { resetTelemetrySchema } from './db-setup';

const REQUIRED_FIELDS = [
  'installationId',
  'version',
  'command',
  'runtimeName',
  'runtimeVersion',
  'os',
  'arch',
] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];

function baseRequiredPayload(): Record<RequiredField, string> {
  return {
    installationId: 'install-base',
    version: '0.8.0',
    command: 'init',
    runtimeName: 'node',
    runtimeVersion: '24.13.0',
    os: 'darwin',
    arch: 'arm64',
  };
}

describe('telemetry POST /events', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let db: TelemetryDb;
  let handler: ReturnType<typeof createHandler>;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  beforeEach(async () => {
    await resetTelemetrySchema(database.connectionString);
    db = createTelemetryDb(database.connectionString);
    handler = createHandler({ db });
  });

  afterEach(async () => {
    await db.runtime().close();
  });

  async function postEvent(payload: unknown): Promise<Response> {
    return handler(
      new Request('http://localhost/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );
  }

  async function fetchRows() {
    return db.orm.public.TelemetryEvent.all();
  }

  async function fetchSingleRow() {
    const rows = await fetchRows();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    return row!;
  }

  async function rowCount(): Promise<number> {
    return (await fetchRows()).length;
  }

  it('accepts events carrying the required-set, optional fields, and unknown future fields; unknown keys are dropped before storage', async () => {
    const payload = {
      ...baseRequiredPayload(),
      installationId: 'install-superset',
      flags: ['yes', 'verbose'],
      packageManager: 'pnpm/10.27.0',
      databaseTarget: 'postgres',
      tsVersion: '5.9.3',
      agent: 'claude-code',
      extensions: ['pgvector', 'paradedb'],
      exitCode: 4,
      // Forward-compat unknown keys; the backend must silently drop these.
      crashStackHash: 'abcdef',
      gpuVendor: 'apple',
      experimentalCapabilities: { foo: 'bar' },
    };

    const response = await postEvent(payload);
    expect(response.status).toBe(202);

    const row = await fetchSingleRow();
    expect(row.installationId).toBe('install-superset');
    expect(row.version).toBe('0.8.0');
    expect(row.command).toBe('init');
    expect(row.runtimeName).toBe('node');
    expect(row.runtimeVersion).toBe('24.13.0');
    expect(row.os).toBe('darwin');
    expect(row.arch).toBe('arm64');
    expect(row.flags).toEqual(['yes', 'verbose']);
    expect(row.packageManager).toBe('pnpm/10.27.0');
    expect(row.databaseTarget).toBe('postgres');
    expect(row.tsVersion).toBe('5.9.3');
    expect(row.agent).toBe('claude-code');
    expect(row.extensions).toEqual(['pgvector', 'paradedb']);
    expect(row.exitCode).toBe(4);
    expect(Object.prototype.toString.call(row.ingestedAt)).toBe('[object Temporal.Instant]');
    expect(row).not.toHaveProperty('crashStackHash');
    expect(row).not.toHaveProperty('gpuVendor');
    expect(row).not.toHaveProperty('experimentalCapabilities');
  });

  it('accepts events carrying only the required-set; omitted nullable scalars become NULL and omitted arrays become []', async () => {
    const payload = {
      ...baseRequiredPayload(),
      installationId: 'install-subset',
    };

    const response = await postEvent(payload);
    expect(response.status).toBe(202);

    const row = await fetchSingleRow();
    expect(row.installationId).toBe('install-subset');
    expect(row.flags).toEqual([]);
    expect(row.extensions).toEqual([]);
    expect(row.packageManager).toBeNull();
    expect(row.databaseTarget).toBeNull();
    expect(row.tsVersion).toBeNull();
    expect(row.exitCode).toBeNull();
    expect(row.agent).toBeNull();
  });

  it('accepts strings and array items at the configured schema bounds', async () => {
    const maxString = 'x'.repeat(MAX_TELEMETRY_STRING_LENGTH);
    const maxArrayItem = 'f'.repeat(MAX_TELEMETRY_ARRAY_ITEM_LENGTH);
    const manyArrayItems = Array.from({ length: 64 }, () => maxArrayItem);
    const payload = {
      installationId: maxString,
      version: maxString,
      command: maxString,
      runtimeName: maxString,
      runtimeVersion: maxString,
      os: maxString,
      arch: maxString,
      flags: manyArrayItems,
      packageManager: maxString,
      databaseTarget: maxString,
      tsVersion: maxString,
      agent: maxString,
      extensions: manyArrayItems,
    };

    const response = await postEvent(payload);
    expect(response.status).toBe(202);

    const row = await fetchSingleRow();
    expect(row.installationId).toBe(maxString);
    expect(row.command).toBe(maxString);
    expect(row.flags).toEqual(manyArrayItems);
    expect(row.extensions).toEqual(manyArrayItems);
  });

  it('rejects strings beyond the configured schema bounds with 400', async () => {
    const response = await postEvent({
      ...baseRequiredPayload(),
      command: 'x'.repeat(MAX_TELEMETRY_STRING_LENGTH + 1),
    });

    expect(response.status).toBe(400);
    expect(await rowCount()).toBe(0);
  });

  it('rejects array items beyond the configured schema bounds with 400', async () => {
    const response = await postEvent({
      ...baseRequiredPayload(),
      flags: ['x'.repeat(MAX_TELEMETRY_ARRAY_ITEM_LENGTH + 1)],
    });

    expect(response.status).toBe(400);
    expect(await rowCount()).toBe(0);
  });

  describe('rejects payloads missing any required field with 400', () => {
    for (const omitted of REQUIRED_FIELDS) {
      it(`rejects a payload missing ${omitted}`, async () => {
        const { [omitted]: _omitted, ...rest } = baseRequiredPayload();
        const response = await postEvent(rest);
        expect(response.status).toBe(400);
        expect(await rowCount()).toBe(0);
      });
    }
  });

  it('rejects a non-POST request with 405', async () => {
    const response = await handler(new Request('http://localhost/events', { method: 'GET' }));
    expect(response.status).toBe(405);
  });

  it('rejects an unknown path with 404', async () => {
    const response = await handler(
      new Request('http://localhost/nope', {
        method: 'POST',
        body: '{}',
      }),
    );
    expect(response.status).toBe(404);
  });

  it('rejects content-length beyond the request cap with 413', async () => {
    const response = await handler(
      new Request('http://localhost/events', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(MAX_EVENT_BODY_BYTES + 1),
        },
        body: JSON.stringify(baseRequiredPayload()),
      }),
    );

    expect(response.status).toBe(413);
    expect(await rowCount()).toBe(0);
  });

  it('rejects streamed bodies beyond the request cap with 413', async () => {
    const oversizedBody = JSON.stringify({
      ...baseRequiredPayload(),
      futureField: 'x'.repeat(MAX_EVENT_BODY_BYTES),
    });
    const request = new Request('http://localhost/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new Blob([oversizedBody], { type: 'application/json' }),
    });
    expect(request.headers.get('content-length')).toBeNull();

    const response = await handler(request);

    expect(response.status).toBe(413);
    expect(await rowCount()).toBe(0);
  });

  it('rejects bodies beyond the request cap even when content-length is understated', async () => {
    const oversizedBody = JSON.stringify({
      ...baseRequiredPayload(),
      futureField: 'x'.repeat(MAX_EVENT_BODY_BYTES),
    });
    const response = await handler(
      new Request('http://localhost/events', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '1',
        },
        body: new Blob([oversizedBody], { type: 'application/json' }),
      }),
    );

    expect(response.status).toBe(413);
    expect(await rowCount()).toBe(0);
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await handler(
      new Request('http://localhost/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      }),
    );
    expect(response.status).toBe(400);
  });
});
