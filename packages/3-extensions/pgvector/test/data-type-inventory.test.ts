import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

/** Every codec this pack ships and the data type it represents. ADR 254, spec B4. */
const EXPECTED: Readonly<Record<string, string>> = {
  'pg/vector@1': 'pgvector/vector',
};

describe('pgvector data type inventory', () => {
  it('ships codecs to check', () => {
    expect(codecDescriptors.length).toBeGreaterThan(0);
  });

  it('names the data type of every codec it ships', () => {
    expect(
      Object.fromEntries(
        codecDescriptors.map((descriptor) => [descriptor.codecId, descriptor.dataType]),
      ),
    ).toEqual(EXPECTED);
  });
});
