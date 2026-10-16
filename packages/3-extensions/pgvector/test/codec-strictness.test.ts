import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { pgVectorDescriptor } from '../src/core/codecs';
import { fromContractJson } from './contract-json';

const ctx: CodecInstanceContext = { name: 'codec-strictness' };

describe('pg/vector@1 reading contract JSON', () => {
  const codec = pgVectorDescriptor.factory({ length: 3 })(ctx);

  it('reads an array of JSON numbers', () => {
    expect(fromContractJson(codec, [0.1, 0.2, 0.3], { length: 3 })).toEqual([0.1, 0.2, 0.3]);
  });

  it.each([
    ['digit text elements', ['1', '2', '3'], '["1","2","3"]'],
    ['decimal text elements', ['1', '0.5', '-2.25'], '["1","0.5","-2.25"]'],
    ['one text element among numbers', [1, 2, '3'], '[1,2,"3"]'],
    ['too few numbers', [1, 2], '[1,2]'],
    ['too many numbers', [1, 2, 3, 4], '[1,2,3,4]'],
    ['text', '[1,2,3]', '"[1,2,3]"'],
  ])('refuses %s with the shared JSON refusal', (_name, json, received) => {
    expect(() => fromContractJson(codec, json, { length: 3 })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message: 'pgvector/vector JSON value must be an array of 3 finite numbers',
        meta: { dataType: 'pgvector/vector', received },
      }),
    );
  });
});
