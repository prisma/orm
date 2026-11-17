import { describe, expect, it } from 'vitest';
import { dataLine, fieldLines, valueLines } from '../../src/orm/data-lines';

describe('dataLine', () => {
  it('joins fields with tabs and keeps an absent field as an empty one', () => {
    expect(dataLine(['app', null, 'sha256:b', 3, undefined, true])).toBe(
      'app\t\tsha256:b\t3\t\ttrue',
    );
  });

  it.each([
    ['a backslash', 'a\\b', 'a\\\\b'],
    ['a tab', 'a\tb', 'a\\tb'],
    ['a newline', 'a\nb', 'a\\nb'],
    ['a carriage return', 'a\rb', 'a\\rb'],
  ])('escapes %s inside a field', (_name, value, escaped) => {
    expect(dataLine(['x', value, 'y'])).toBe(`x\t${escaped}\ty`);
  });

  it('escapes a backslash before the characters it introduces', () => {
    expect(dataLine(['\\n\n'])).toBe('\\\\n\\n');
  });
});

describe('fieldLines', () => {
  it('writes one key-tab-value line per present field, in order', () => {
    expect(
      fieldLines([
        ['name', '20260101T1000_init'],
        ['from', null],
        ['to', 'sha256:b'],
        ['operations', 2],
      ]),
    ).toEqual(['name\t20260101T1000_init', 'to\tsha256:b', 'operations\t2']);
  });

  it('escapes the value', () => {
    expect(fieldLines([['label', 'one\ttwo']])).toEqual(['label\tone\\ttwo']);
  });
});

describe('valueLines', () => {
  it('writes one escaped line per value, so a path holding a newline stays one line', () => {
    expect(valueLines(['prisma/contract.json', 'odd\nname/contract.d.ts', 'C:\\dir'])).toEqual([
      'prisma/contract.json',
      'odd\\nname/contract.d.ts',
      'C:\\\\dir',
    ]);
  });
});
