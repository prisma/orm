import { describe, expect, it } from 'vitest';
import { prismaAdapter } from '../../src/exports/index';
import type { SqlContract } from '../../src/models/model-lookup';

// assertClient reads only the target and the namespaces of the contract.
const contract = { target: 'postgres', domain: { namespaces: {} } } as unknown as SqlContract;

describe('the transaction option', () => {
  it('accepts a client without transaction() while it is off', () => {
    expect(() => prismaAdapter({ contract, orm: {} })).not.toThrow();
  });

  it('refuses a client without transaction() when it is on, as a JavaScript caller might pass it', () => {
    const options = { transaction: true } as const;
    expect(() =>
      // @ts-expect-error the type already refuses it
      prismaAdapter({ contract, orm: {} }, options),
    ).toThrow(
      'The transaction option runs Better Auth transactions through the client’s transaction(), which this client does not have. Its contract does not list interactive transactions, so turn the option off.',
    );
  });
});
