import { describe, expect, it } from 'vitest';
import { enumMemberCodecFor, type MongoCodecLookup } from '../src/execution-context';

describe('enumMemberCodecFor', () => {
  it("returns an enum's codec from the lookup", () => {
    const codec = { id: 'test/level@1' };
    const codecs = {
      get: (id: string) => (id === 'test/level@1' ? codec : undefined),
      has: (id: string) => id === 'test/level@1',
    } as unknown as MongoCodecLookup;

    expect(enumMemberCodecFor(codecs)('test/level@1')).toBe(codec);
  });

  it('refuses an enum whose codec the lookup lacks', () => {
    const codecs: MongoCodecLookup = { get: () => undefined, has: () => false };

    expect(() => enumMemberCodecFor(codecs)('test/level@1')).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.CODEC_DESCRIPTOR_MISSING',
        message:
          "No codec is registered for codecId 'test/level@1', which a domain enum in the contract uses.",
      }),
    );
  });
});
