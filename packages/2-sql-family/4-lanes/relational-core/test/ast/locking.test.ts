import { describe, expect, it } from 'vitest';
import {
  lockIncompatible,
  lockOptionCapabilities,
  lockStrengthCapabilities,
  lockWaitPolicyOf,
  missingCapability,
} from '../../src/ast/locking';

describe('locking vocabulary', () => {
  it('maps each strength and option to its capability', () => {
    expect({ strengths: lockStrengthCapabilities, options: lockOptionCapabilities }).toEqual({
      strengths: {
        forUpdate: { sql: { forUpdate: true } },
        forNoKeyUpdate: { postgres: { forNoKeyUpdate: true } },
        forShare: { sql: { forShare: true } },
        forKeyShare: { postgres: { forKeyShare: true } },
      },
      options: {
        of: { sql: { lockOf: true } },
        nowait: { sql: { lockNowait: true } },
        skipLocked: { sql: { lockSkipLocked: true } },
      },
    });
  });

  describe('missingCapability', () => {
    it('is undefined when the flag is reported', () => {
      expect(missingCapability({ sql: { forUpdate: true } }, { sql: { forUpdate: true } })).toBe(
        undefined,
      );
    });

    it.each([
      { capabilities: {} },
      { capabilities: { sql: {} } },
      { capabilities: { sql: { forUpdate: false } } },
      { capabilities: { postgres: { forUpdate: true } } },
    ])('names the flag when capabilities are $capabilities', ({ capabilities }) => {
      expect(missingCapability(capabilities, { sql: { forUpdate: true } })).toBe('sql.forUpdate');
    });
  });

  describe('lockWaitPolicyOf', () => {
    it.each([
      { options: undefined, policy: undefined },
      { options: {}, policy: undefined },
      { options: { nowait: true }, policy: 'nowait' },
      { options: { skipLocked: true }, policy: 'skipLocked' },
    ] as const)('$options gives $policy', ({ options, policy }) => {
      expect(lockWaitPolicyOf('forUpdate', options)).toBe(policy);
    });

    it('refuses nowait with skipLocked', () => {
      expect(() => lockWaitPolicyOf('forShare', { nowait: true, skipLocked: true })).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message: 'forShare() takes nowait or skipLocked, not both',
          meta: { method: 'forShare' },
        }),
      );
    });
  });

  it('lockIncompatible carries the conflict in meta', () => {
    expect(lockIncompatible('includeRefinement', 'message')).toEqual(
      expect.objectContaining({
        name: 'StructuredError',
        code: 'ORM.LOCK_INCOMPATIBLE',
        message: 'message',
        meta: { conflict: 'includeRefinement' },
      }),
    );
  });
});
