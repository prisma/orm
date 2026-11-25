import postgresAdapter from '@internal/adapter-postgres/runtime';
import postgresDriver from '@internal/driver-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { defaultConnectionCapabilities } from '../../src/contract/contract-capabilities';

describe('the default connection capabilities do not change within a major version', () => {
  it('changing them changes the profile hash of every contract that keeps the default list, so every signed database must be signed again: only a major version may do that', () => {
    expect(defaultConnectionCapabilities).toEqual([{}, { sql: { interactiveTransactions: true } }]);
    expect(defaultConnectionCapabilities).toEqual([
      postgresAdapter.capabilities,
      postgresDriver.capabilities,
    ]);
  });
});
