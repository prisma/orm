import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/arktype-json-codec';
import { arktypeJsonPackMeta } from '../src/core/pack-meta';

/**
 * Every codec this pack ships and the data type it represents. This extension registers no data
 * type of its own: its codec stores what a `jsonb` column stores, and differs only in the value it
 * produces in memory. ADR 254.
 */
const EXPECTED: Readonly<Record<string, string>> = {
  'arktype/json@1': 'pg/jsonb',
};

describe('arktype-json data type inventory', () => {
  it('registers no data type of its own', () => {
    expect(Object.hasOwn(arktypeJsonPackMeta, 'dataTypes')).toBe(false);
  });

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
