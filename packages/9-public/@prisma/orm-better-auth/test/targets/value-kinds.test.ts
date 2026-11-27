import { describe, expect, it } from 'vitest';
import { valueKindOf } from '../../src/targets/value-kinds';

describe('valueKindOf', () => {
  it('finds the kind a table lists a codec under, and none for a codec it does not list', () => {
    const valueKind = valueKindOf({ string: ['a/text@1'] }, { number: ['a/int@1'] });
    expect([valueKind('a/text@1'), valueKind('a/int@1'), valueKind('a/other@1')]).toEqual([
      'string',
      'number',
      undefined,
    ]);
  });

  it('refuses a codec listed under two kinds, in one table or across tables', () => {
    expect(() => valueKindOf({ string: ['a/text@1'], other: ['a/text@1'] })).toThrow(
      'Codec "a/text@1" is listed twice in a target support\'s value kinds: as string and as other.',
    );
    expect(() => valueKindOf({ string: ['a/text@1'] }, { string: ['a/text@1'] })).toThrow(
      'Codec "a/text@1" is listed twice in a target support\'s value kinds: as string and as string.',
    );
  });
});
