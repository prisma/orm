import { describe, expect, it } from 'vitest';
import {
  temporalTypeAliases,
  timestampNowControlDescriptor,
} from '../src/shared/temporal-type-aliases';

describe('timestampNow generator', () => {
  it('builds a control descriptor that registers the generator id', () => {
    expect(timestampNowControlDescriptor()).toEqual({ id: 'timestampNow' });
  });
});

describe('temporalTypeAliases', () => {
  it('calls now() on create for CreatedAt and on create and update for UpdatedAt', () => {
    const type = { codecId: 'test/timestamp@1' } as const;
    expect(temporalTypeAliases(type, 'a JavaScript Date')).toEqual({
      CreatedAt: {
        kind: 'typeAlias',
        documentation:
          'A timestamp the client sets to now when a row is created. Its value is a JavaScript Date.',
        output: { type, onCreate: { name: 'now', args: {} } },
      },
      UpdatedAt: {
        kind: 'typeAlias',
        documentation:
          'A timestamp the client sets to now when a row is created and every time it is updated. Its value is a JavaScript Date.',
        output: {
          type,
          onCreate: { name: 'now', args: {} },
          onUpdate: { name: 'now', args: {} },
        },
      },
    });
  });
});
