import { describe, expect, it } from 'vitest';
import { nonEmptyTypeParams } from '../src/ir/storage-type-instance';

describe('nonEmptyTypeParams', () => {
  it('reads empty or missing parameters as none', () => {
    expect({
      own: nonEmptyTypeParams({ length: 3 }),
      empty: nonEmptyTypeParams({}),
      none: nonEmptyTypeParams(undefined),
    }).toEqual({ own: { length: 3 }, empty: undefined, none: undefined });
  });
});
