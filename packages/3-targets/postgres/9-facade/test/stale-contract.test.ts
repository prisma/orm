import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import postgres from '../src/exports/runtime';
import type { PostgresStackProvides } from '../src/runtime/stack-capabilities';
import { contractFromJson } from '../src/static/contract-from-json';
import type { Contract } from './fixtures/emitted-before-capabilities-by-version/contract';
import staleContractJson from './fixtures/emitted-before-capabilities-by-version/contract.json' with {
  type: 'json',
};

// Emitted before a contract stated its database version: it lists flags nothing declares any more.
const staleContract = contractFromJson<Contract>(staleContractJson);
const staleFlags = [
  'postgres.jsonAgg',
  'postgres.lateral',
  'postgres.limit',
  'postgres.orderBy',
  'postgres.returning',
  'sql.enums',
] as const;

describe('a contract emitted by an earlier Prisma version', () => {
  it('warns when the client is created, naming the flags and saying to emit the contract again', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    // @ts-expect-error the adapter and driver do not provide postgres.jsonAgg: emit the contract again, ...
    postgres({ contract: staleContract, url: 'postgres://localhost/db', log });
    expect(log.warn.mock.calls).toEqual([
      [
        expect.objectContaining({
          code: 'CONTRACT.CAPABILITIES_NOT_PROVIDED',
          missing: [...staleFlags],
          message: expect.stringContaining(
            'A contract emitted by an earlier Prisma version is emitted again.',
          ),
        }),
      ],
    ]);
  });

  it('is a type error at creation whose text says to emit the contract again', () => {
    expectTypeOf<
      keyof PostgresStackProvides<Contract>
    >().toEqualTypeOf<`the adapter and driver do not provide ${(typeof staleFlags)[number]}: emit the contract again, and if it still requires it, state the capabilities of the driver the application runs with`>();
  });
});
