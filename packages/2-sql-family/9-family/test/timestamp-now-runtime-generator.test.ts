import { afterEach, describe, expect, it, vi } from 'vitest';
import { timestampNowRuntimeGenerator } from '../src/core/timestamp-now-runtime-generator';

describe('timestampNowRuntimeGenerator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('generates the current time once per ORM operation', () => {
    vi.useFakeTimers({ now: new Date('2024-01-02T23:59:59.999Z') });
    const generator = timestampNowRuntimeGenerator();
    expect(generator).toMatchObject({ id: 'timestampNow', stability: 'query' });
    expect(generator.generate()).toEqual(new Date('2024-01-02T23:59:59.999Z'));
  });

  it.each([
    [0, '2024-01-02T23:59:59.000Z'],
    [1, '2024-01-02T23:59:59.900Z'],
    [2, '2024-01-02T23:59:59.990Z'],
    [3, '2024-01-02T23:59:59.999Z'],
    [6, '2024-01-02T23:59:59.999Z'],
  ])(
    'rounds down to precision %s, so the column stores the value the client holds',
    (precision, iso) => {
      vi.useFakeTimers({ now: new Date('2024-01-02T23:59:59.999Z') });
      expect(timestampNowRuntimeGenerator().generate({ precision })).toEqual(new Date(iso));
    },
  );
});
