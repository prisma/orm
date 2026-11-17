import postgres from '@internal/postgres/runtime';
import { contractFromJson } from '@internal/postgres/static';
import { Client, type Pool, type PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);

function clientRejectingQueries(error: Error) {
  const pg = new Client();
  vi.spyOn(pg, 'query').mockRejectedValue(error);
  return postgres({ contract, pg, verifyMarker: false });
}

function clientRejectingTransactionStart(error: Error) {
  const transactionClient = new Client();
  vi.spyOn(transactionClient, 'query').mockRejectedValue(error);
  Object.assign(transactionClient, { release: vi.fn() });
  const pool = {
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    connect: vi.fn().mockResolvedValue(transactionClient as unknown as PoolClient),
    on: vi.fn(),
  } as unknown as Pool;
  return postgres({ contract, pg: pool, verifyMarker: false });
}

describe('ports/prisma/functional/driver-adapters/error-forwarding', () => {
  it.fails('correctly forwards error for queryRaw', async () => {
    const queryError = new Error('queryRaw sentinel');
    const db = clientRejectingQueries(queryError);

    await expect(db.orm.public.User.first()).rejects.toBe(queryError);
    await db.close();
  });

  it('correctly forwards error for implicit transactions', async () => {
    const startTransactionError = new Error('startTransaction sentinel');
    const db = clientRejectingTransactionStart(startTransactionError);

    const result = db.orm.public.User.create({
      id: 'user-id',
      profile: (profile) => profile.create({ id: 'profile-id' }),
    });
    await expect(result).rejects.toBe(startTransactionError);
    await db.close();
  });

  it('correctly forwards error for itx', async () => {
    const startTransactionError = new Error('startTransaction sentinel');
    const db = clientRejectingTransactionStart(startTransactionError);

    await expect(db.transaction(async () => undefined)).rejects.toBe(startTransactionError);
    await db.close();
  });
});
