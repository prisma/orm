import postgresDriverDescriptor from '@internal/driver-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { postgresDriver } from '../../src/contract/contract-capabilities';

describe("the driver's capability keys do not change within a major version", () => {
  it('changing them changes the profile hash of every contract that spreads them, so every signed database must be signed again: only a major version may do that', () => {
    expect(postgresDriver).toEqual(['sql.interactiveTransactions']);
    expect(postgresDriverDescriptor.capabilities).toEqual({
      sql: { interactiveTransactions: true },
    });
  });
});
