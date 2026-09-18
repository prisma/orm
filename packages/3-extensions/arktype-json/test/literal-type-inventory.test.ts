import type { LiteralTypeDeclaration } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/arktype-json-codec';

const EXPECTED: Readonly<Record<string, readonly LiteralTypeDeclaration[]>> = {
  'arktype/json@1': ['json'],
};

describe('arktype-json literal type inventory', () => {
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
