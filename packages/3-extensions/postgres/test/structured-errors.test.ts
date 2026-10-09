import { sql } from '@internal/sql-contract/sql-expression';
import type { SqlStorage } from '@internal/sql-contract/types';
import { isInternalError } from '@internal/utils/internal-error';
import { isStructuredError } from '@internal/utils/structured-error';
import { createContract } from '@repo/test-utils';
import type { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';

vi.mock('pg', () => {
  class FakePoolClient {
    query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    release = vi.fn();
  }

  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(new FakePoolClient());
    end = vi.fn().mockResolvedValue(undefined);
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
  }

  class Client {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    end = vi.fn().mockResolvedValue(undefined);
    escapeIdentifier = vi.fn();
    escapeLiteral = vi.fn();
  }

  return { Pool, Client };
});

import { nativeEnum } from '../src/contract/native-enum';
import { policySelect } from '../src/contract/rls';
import { resolvePostgresBinding } from '../src/runtime/binding';
import postgres from '../src/runtime/postgres';

const contract = createContract<SqlStorage>();

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

async function captureAsync(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject');
}

describe('nativeEnum raises CONTRACT.ENUM_INVALID', () => {
  it('duplicate member value', () => {
    const error = capture(() => nativeEnum('DupEnum', 'a', 'b', 'a'));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.ENUM_INVALID',
      message: 'nativeEnum("DupEnum"): duplicate member value "a". Member values must be unique.',
      meta: { enumName: 'DupEnum', member: 'a' },
    });
  });

  it('empty name', () => {
    const error = capture(() => nativeEnum('', 'a'));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.ENUM_INVALID' });
  });

  it('empty .map() type name', () => {
    const error = capture(() => nativeEnum('X', 'a').map(''));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.ENUM_INVALID' });
  });

  it('empty member list', () => {
    const untypedNativeEnum = nativeEnum as (name: string, ...members: string[]) => unknown;
    const error = capture(() => untypedNativeEnum('EmptyEnum'));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.ENUM_INVALID' });
  });
});

describe('RLS policy helpers raise CONTRACT.POLICY_INVALID', () => {
  const Profile = { stageOne: { fields: {} } };

  it('empty policy name', () => {
    const error = capture(() => policySelect(Profile, { name: '', roles: [], using: sql`true` }));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.POLICY_INVALID' });
  });

  it('unsupported predicate for the operation', () => {
    type UntypedPolicyHelper = (model: unknown, descriptor: unknown) => unknown;
    const untypedPolicySelect = policySelect as UntypedPolicyHelper;
    const error = capture(() =>
      untypedPolicySelect(Profile, { name: 'p_read', roles: [], withCheck: 'true' }),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.POLICY_INVALID',
      meta: { policyName: 'p_read' },
    });
  });
});

describe('binding validation raises RUNTIME.BINDING_INVALID', () => {
  it('empty url', () => {
    const error = capture(() => resolvePostgresBinding({ url: '   ' }));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.BINDING_INVALID',
      message: 'Postgres URL must be a non-empty string',
      meta: { extension: 'postgres' },
    });
  });

  it('unparseable url', () => {
    const error = capture(() => resolvePostgresBinding({ url: 'not a url' }));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'RUNTIME.BINDING_INVALID' });
  });

  it('wrong scheme', () => {
    const error = capture(() => resolvePostgresBinding({ url: 'mysql://localhost:3306/db' }));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.BINDING_INVALID',
      message: 'Postgres URL must use postgres:// or postgresql://',
      meta: { received: 'mysql:' },
    });
  });

  it('unrecognizable pg object', () => {
    const error = capture(() =>
      resolvePostgresBinding({
        pg: { query: () => {} } as unknown as Client,
      }),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'RUNTIME.BINDING_INVALID' });
  });
});

describe('facade lifecycle codes', () => {
  it('connect() without a binding raises RUNTIME.BINDING_MISSING', async () => {
    const db = postgres({ contract } as Parameters<typeof postgres<typeof contract>>[0]);
    const error = await captureAsync(() => db.connect().then(() => undefined));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.BINDING_MISSING',
      meta: { extension: 'postgres' },
    });
  });

  it('second connect() raises DRIVER.ALREADY_CONNECTED', async () => {
    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    await db.connect();
    const error = await captureAsync(() => db.connect().then(() => undefined));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'DRIVER.ALREADY_CONNECTED',
      message: 'Postgres client already connected',
    });
  });

  it('runtime() after close() raises DRIVER.NOT_CONNECTED', async () => {
    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    await db.close();
    const error = capture(() => db.runtime());
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'Postgres client is closed',
    });
  });

  it('connect() after close() raises DRIVER.NOT_CONNECTED', async () => {
    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    await db.close();
    const error = await captureAsync(() => db.connect().then(() => undefined));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
  });
});

describe('binding input count', () => {
  it('zero binding inputs raises RUNTIME.BINDING_INVALID, not an internal error', () => {
    const error = capture(() =>
      resolvePostgresBinding({} as Parameters<typeof resolvePostgresBinding>[0]),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(isInternalError(error)).toBe(false);
    expect(error).toMatchObject({
      code: 'RUNTIME.BINDING_INVALID',
      message: 'Provide one binding input: binding, url, or pg',
    });
  });
});
