import type { LiteralTypeDeclaration } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

const EXPECTED: Readonly<Record<string, readonly LiteralTypeDeclaration[]>> = {
  'pg/geometry@1': ['string'],
};

describe('postgis literal type inventory', () => {
  it('registers codecs to check', () => {
    expect(codecDescriptors.length).toBeGreaterThan(0);
  });

  it('declares the literal types of every registered codec', () => {
    expect(
      Object.fromEntries(
        codecDescriptors.map((descriptor) => [descriptor.codecId, descriptor.literalTypes ?? []]),
      ),
    ).toEqual(EXPECTED);
  });
});
