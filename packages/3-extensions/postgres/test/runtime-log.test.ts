import { lints } from '@internal/sql-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contractFromJson } from '../src/static/contract-from-json';
import type { Contract } from './fixtures/generated/contract';
import fixtureContractJson from './fixtures/generated/contract.json' with { type: 'json' };

// Only mock the third-party pg boundary. Real drivers, adapters, and runtimes
// run over this fake pool and client, which return no rows, so no marker is found.
vi.mock('pg', () => {
  class FakePoolClient {
    query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    release = vi.fn();
    on = vi.fn();
  }

  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(new FakePoolClient());
    end = vi.fn().mockResolvedValue(undefined);
  }

  class Client {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    end = vi.fn().mockResolvedValue(undefined);
  }

  return { Pool, Client };
});

import postgres from '../src/runtime/postgres';
import postgresServerless from '../src/runtime/postgres-serverless';

const fixtureContract = contractFromJson<Contract>(fixtureContractJson);
const url = 'postgres://localhost:5432/db';
const markerMissing = expect.objectContaining({
  code: 'CONTRACT.MARKER_MISSING',
  scope: 'marker-verification',
});

function spyLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('postgres log option', () => {
  it('receives the marker-verification warning when the database has no marker', async () => {
    const log = spyLog();
    const db = postgres({ contract: fixtureContract, url, log });

    await db.orm.public.User.first();

    expect(log.warn).toHaveBeenCalledWith(markerMissing);
    await db.close();
  });

  it('receives the lints() warning for an ORM read with no limit', async () => {
    const log = spyLog();
    const db = postgres({
      contract: fixtureContract,
      url,
      middleware: [lints()],
      log,
    });

    await db.orm.public.User.all().toArray();

    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ code: 'LINT.NO_LIMIT' }));
    await db.close();
  });

  it('without a log, a read on a database with no marker still succeeds', async () => {
    const db = postgres({ contract: fixtureContract, url });

    await expect(db.orm.public.User.first()).resolves.toBeNull();
    await db.close();
  });
});

describe('postgresServerless log option', () => {
  it('receives the marker-verification warning when the database has no marker', async () => {
    const log = spyLog();
    const db = await postgresServerless({ contract: fixtureContract, log }).connect({
      url,
    });

    await db.orm.public.User.first();

    expect(log.warn).toHaveBeenCalledWith(markerMissing);
    await db.close();
  });

  it('without a log, a read on a database with no marker still succeeds', async () => {
    const db = await postgresServerless({ contract: fixtureContract }).connect({
      url,
    });

    await expect(db.orm.public.User.first()).resolves.toBeNull();
    await db.close();
  });
});
