import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it, vi } from 'vitest';
import { defineContract, postgres18, postgresDriver } from '../src/exports/contract-builder';
import postgres from '../src/exports/runtime';
import postgresServerless from '../src/exports/serverless';

const url = 'postgres://localhost:5432/db';

const providedByTheStack = defineContract({
  requiredCapabilities: [...postgres18, ...postgresDriver],
});
// A contract whose list names what a driver over HTTP provides, which the facade's own driver is not.
const requiringBatches = defineContract({
  requiredCapabilities: [...postgres18, ...postgresDriver, 'http.batch'],
});

function spyLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const notProvided = {
  code: 'CONTRACT.CAPABILITIES_NOT_PROVIDED',
  scope: 'stack-verification',
  missing: ['http.batch'],
  message:
    "Your contract requires `http.batch`, which this client's connection does not provide. Remove it from your contract's required capabilities, or connect with a driver that provides it.",
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
