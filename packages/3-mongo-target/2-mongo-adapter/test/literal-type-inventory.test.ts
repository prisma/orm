import type { LiteralTypeDeclaration } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { mongoCodecDescriptors } from '../src/core/codecs';

/** Mongo reads no literal default: a Mongo default is authored in TypeScript, not in PSL. */
const EXPECTED: Readonly<Record<string, readonly LiteralTypeDeclaration[]>> = {
  'mongo/objectId@1': [],
  'mongo/string@1': [],
  'mongo/double@1': [],
  'mongo/int32@1': [],
  'mongo/bool@1': [],
  'mongo/date@1': [],
  'mongo/vector@1': [],
};

describe('mongo literal type inventory', () => {
  it('registers codecs to check', () => {
    expect(mongoCodecDescriptors.length).toBeGreaterThan(0);
  });

  it('declares the literal types of every registered codec', () => {
    expect(
      Object.fromEntries(
        mongoCodecDescriptors.map((descriptor) => [
          descriptor.codecId,
          descriptor.literalTypes ?? [],
        ]),
      ),
    ).toEqual(EXPECTED);
  });
});
