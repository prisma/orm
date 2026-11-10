import { describe, expect, it } from 'vitest';
import { timestampNowRuntimeGenerator } from '../src/core/timestamp-now-runtime-generator';

describe('timestampNowRuntimeGenerator', () => {
  it('generates the current time once per ORM operation', () => {
    const generator = timestampNowRuntimeGenerator();
    const before = Date.now();
    const value = generator.generate();
    expect(generator).toMatchObject({ id: 'timestampNow', stability: 'query' });
    expect(value).toBeInstanceOf(Date);
    expect((value as Date).getTime()).toBeGreaterThanOrEqual(before);
  });
});
