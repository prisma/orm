import { DEFAULT_POLICIES } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { checkRunPolicies } from '../../src/control-api/operations/database-policies';

const TARGET = 'b'.repeat(64);

describe('checkRunPolicies', () => {
  it('refuses db update when an extension space changes only through migrations', () => {
    const result = checkRunPolicies({
      command: 'db update',
      appSpaceId: 'app',
      inForce: new Map([
        ['app', DEFAULT_POLICIES],
        ['pgvector', { ...DEFAULT_POLICIES, change: ['migrate'] }],
      ]),
      ref: undefined,
      permitPolicyChange: false,
      targetHash: TARGET,
      invocation: undefined,
    });

    expect(result.ok ? undefined : result.failure.meta).toEqual({
      spaceId: 'pgvector',
      command: 'db update',
      change: ['migrate'],
    });
  });

  it('writes nothing when the ref declares only settings already in force', () => {
    const result = checkRunPolicies({
      command: 'db migrate',
      appSpaceId: 'app',
      inForce: new Map([['app', DEFAULT_POLICIES]]),
      ref: {
        name: 'production',
        hash: TARGET,
        invariants: [],
        policies: { dataProtection: { dataLoss: 'data-loss-with-consent' } },
      },
      permitPolicyChange: false,
      targetHash: TARGET,
      invocation: undefined,
    });

    expect(result.ok ? result.value : result.failure).toBeUndefined();
  });
});
