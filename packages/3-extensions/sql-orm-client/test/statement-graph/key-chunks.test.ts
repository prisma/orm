import { describe, expect, it } from 'vitest';
import { chunkKeys, estimatedKeyBytes } from '../../src/statement-graph/key-chunks';

const unlimited = { parameters: Number.POSITIVE_INFINITY, bytes: Number.POSITIVE_INFINITY };

describe('chunkKeys', () => {
  it('returns no chunk for no keys', () => {
    expect(chunkKeys([], unlimited)).toEqual([]);
  });

  it('keeps every key in one chunk when no limit is reached', () => {
    expect(chunkKeys([{ id: 1 }, { id: 2 }], unlimited)).toEqual([[{ id: 1 }, { id: 2 }]]);
  });

  it('splits by bound parameters, one per key column', () => {
    const keys = [1, 2, 3, 4, 5].map((id) => ({ id }));
    expect(chunkKeys(keys, { ...unlimited, parameters: 2 })).toEqual([
      [{ id: 1 }, { id: 2 }],
      [{ id: 3 }, { id: 4 }],
      [{ id: 5 }],
    ]);
  });

  it('counts every column of a composite key as a parameter', () => {
    const keys = [1, 2, 3].map((id) => ({ tenant: 't', id }));
    expect(chunkKeys(keys, { ...unlimited, parameters: 5 })).toEqual([
      [
        { tenant: 't', id: 1 },
        { tenant: 't', id: 2 },
      ],
      [{ tenant: 't', id: 3 }],
    ]);
  });

  it('splits by the estimated size of the key values', () => {
    const keys = ['aaaa', 'bbbb', 'cccc'].map((id) => ({ id }));
    expect(chunkKeys(keys, { ...unlimited, bytes: 16 })).toEqual([
      [{ id: 'aaaa' }, { id: 'bbbb' }],
      [{ id: 'cccc' }],
    ]);
  });

  it('puts a key larger than the size limit in a chunk of its own', () => {
    const keys = [{ id: 'a' }, { id: 'x'.repeat(100) }, { id: 'b' }];
    expect(chunkKeys(keys, { ...unlimited, bytes: 10 })).toEqual([
      [{ id: 'a' }],
      [{ id: 'x'.repeat(100) }],
      [{ id: 'b' }],
    ]);
  });
});

describe('estimatedKeyBytes', () => {
  it.each([
    ['twice the UTF-8 length of a string', { id: 'é' }, 4],
    ['twice the length of a byte array', { id: new Uint8Array(3) }, 6],
    ['the decimal text of a bigint', { id: 12345n }, 5],
    ['32 bytes for any other value', { id: 7 }, 32],
    ['the sum over the columns of a key', { tenant: 'ab', id: 1 }, 36],
  ])('counts %s', (_rule, key, bytes) => {
    expect(estimatedKeyBytes(key)).toBe(bytes);
  });
});
