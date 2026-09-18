import type { LiteralTypeDeclaration } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

const EXPECTED: Readonly<Record<string, readonly LiteralTypeDeclaration[]>> = {
  'pg/vector@1': [{ list: ['i8', 'i16', 'i32', 'i64', 'bigint', 'decimal'] }],
};

describe('pgvector literal type inventory', () => {
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
