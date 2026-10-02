import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

/** Every codec this target ships and the data type it represents. ADR 254, design 9.2. */
const EXPECTED: Readonly<Record<string, string>> = {
  'sqlite/text@1': 'sqlite/text',
  'sql/char@1': 'sqlite/character',
  'sql/varchar@1': 'sqlite/character-varying',
  'sqlite/datetime@1': 'sqlite/text',
  'sqlite/json@1': 'sqlite/text',
  'sqlite/blob@1': 'sqlite/blob',
  'sqlite/integer@1': 'sqlite/integer',
  'sql/int@1': 'sqlite/integer',
  'sqlite/bigint@1': 'sqlite/integer',
  'sqlite/bigintnumber@1': 'sqlite/integer',
  'sqlite/real@1': 'sqlite/real',
  'sql/float@1': 'sqlite/real',
};

describe('sqlite data type inventory', () => {
  it('names the data type of every codec it ships', () => {
    expect(
      Object.fromEntries(
        codecDescriptors.map((descriptor) => [descriptor.codecId, descriptor.dataType]),
      ),
    ).toEqual(EXPECTED);
  });
});
