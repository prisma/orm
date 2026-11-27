import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import postgres from '../src/exports/runtime';
import type { PostgresStackProvides } from '../src/runtime/stack-capabilities';
import { contractFromJson } from '../src/static/contract-from-json';
import type { Contract } from './fixtures/emitted-before-capabilities-by-version/contract';
import staleContractJson from './fixtures/emitted-before-capabilities-by-version/contract.json' with {
  type: 'json',
};

// Emitted before a contract listed its required capabilities: it names flags nothing reads any more, and no connection capability.
const staleContract = contractFromJson<Contract>(staleContractJson);

describe('a contract emitted by an earlier Prisma version', () => {
  it('creates a client with no warning: the flags it names that nothing reads are retired', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    postgres({ contract: staleContract, url: 'postgres://localhost/db', log });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('is no type error at creation', () => {
    expectTypeOf<PostgresStackProvides<Contract>>().toEqualTypeOf<unknown>();
  });

  it('may call transaction(), which every client of that version offered, though it names no interactive transactions', () => {
    const db = postgres({ contract: staleContract, url: 'postgres://localhost/db' });
    expectTypeOf(async () => 1).toExtend<Parameters<typeof db.transaction<number>>[0]>();
  });
});
