import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it, vi } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';
import postgres from '../src/exports/runtime';
import postgresServerless from '../src/exports/serverless';

const url = 'postgres://localhost:5432/db';

const providedByTheStack = defineContract({ version: 18 });
// A contract whose list names a driver over HTTP, which the facade's own driver is not.
const requiringBatches = defineContract({
  version: 18,
  capabilities: [{ sql: { interactiveTransactions: true } }, { http: { batch: true } }],
});

function spyLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const notProvided = {
  code: 'CONTRACT.CAPABILITIES_NOT_PROVIDED',
  scope: 'stack-verification',
  missing: ['http.batch'],
  message:
    "The contract requires http.batch, which the client's adapter and driver do not provide. A contract emitted by an earlier Prisma version is emitted again. Otherwise state the capabilities of the driver the application runs with where the contract is written, emit the contract, and sign the database again.",
};

// Typed as any contract, so the compile-time check, tested in stack-capabilities.types.test-d.ts, leaves the run-time one to be seen.
const factories = {
  postgres: (contract: Contract<SqlStorage>, options: object) =>
    postgres({ contract, url, ...options }),
  postgresServerless: (contract: Contract<SqlStorage>, options: object) =>
    postgresServerless({ contract, ...options }),
};

describe.each(Object.entries(factories))(
  '%s checks its stack against the contract',
  (_, create) => {
    it('warns nothing when the adapter and driver provide what the contract requires', () => {
      const log = spyLog();
      create(providedByTheStack, { log });
      expect(log.warn).not.toHaveBeenCalled();
    });

    it('warns once, when the client is created, naming each capability the stack lacks', () => {
      const log = spyLog();
      create(requiringBatches, { log });
      expect(log.warn.mock.calls).toEqual([[notProvided]]);
    });

    it('warns nothing when the signature check is turned off', () => {
      const log = spyLog();
      create(requiringBatches, { log, verifyMarker: false });
      expect(log.warn).not.toHaveBeenCalled();
    });
  },
);
