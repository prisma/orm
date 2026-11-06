import type { SqlStorage } from '@internal/sql-contract/types';
import { SelectAst, TableSource } from '@internal/sql-relational-core/ast';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { lints } from '@internal/sql-runtime';
import { createContract } from '@repo/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only mock the pg boundary. The real postgres driver, adapter, and runtime run
// over a fake pool client that returns no rows, so no marker is found.
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

  class Client {}

  return { Pool, Client };
});

import supabase from '../src/runtime/supabase';

const contract = createContract<SqlStorage>();
const fixtureJwt = 'fixture-jwt-signing-input-not-a-real-credential';

function stubPlan(): SqlQueryPlan {
  return {
    ast: SelectAst.from(TableSource.named('stub')),
    params: [],
    meta: {
      target: contract.target,
      targetFamily: contract.targetFamily,
      storageHash: contract.storage.storageHash,
      lane: 'raw',
    },
  };
}

async function readAsAnon(db: Awaited<ReturnType<typeof supabase<typeof contract>>>) {
  const anon = db.asAnon();
  return anon.query(stubPlan() as unknown as Parameters<typeof anon.query>[0]).toArray();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('supabase log option', () => {
  it('receives the marker-verification warning when the database has no marker', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
      log,
    });

    await readAsAnon(db);

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CONTRACT.MARKER_MISSING', scope: 'marker-verification' }),
    );
    await db.close();
  });

  it('receives the lints() warning for a read through the auth and storage runtime', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
      middleware: [lints()],
      log,
    });
    const internal = db.asServiceRole().supabase;

    await internal.query(internal.sql.auth.users.select('id').build()).toArray();

    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ code: 'LINT.NO_LIMIT' }));
    await db.close();
  });

  it('without a log, a read on a database with no marker still succeeds', async () => {
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });

    await expect(readAsAnon(db)).resolves.toEqual([]);
    await db.close();
  });
});
