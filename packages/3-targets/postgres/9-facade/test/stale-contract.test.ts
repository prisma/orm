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
  it('warns when the client is created, naming the flags and saying to remove them', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    // @ts-expect-error postgres.jsonAgg is required by the contract but not provided by its database version, adapter, driver or extensions
    postgres({ contract: staleContract, url: 'postgres://localhost/db', log });
    expect(log.warn.mock.calls).toEqual([
      [
        expect.objectContaining({
          code: 'CONTRACT.CAPABILITIES_NOT_PROVIDED',
          missing: [...staleFlags],
          message: expect.stringContaining(
            'Either remove the capabilities from your contract, or install a component that provides them.',
          ),
        }),
      ],
    ]);
  });

  it('is a type error at creation that names each flag the stack does not provide', () => {
    expectTypeOf<
      keyof PostgresStackProvides<Contract>
    >().toEqualTypeOf<`${(typeof staleFlags)[number]} is required by the contract but not provided by its database version, adapter, driver or extensions`>();
  });
});
