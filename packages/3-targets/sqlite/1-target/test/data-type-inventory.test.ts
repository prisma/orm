import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

/** Every codec this target ships and the data type it represents (ADR 254). */
const EXPECTED: Readonly<Record<string, string>> = {
  'sqlite/text@1': 'sqlite/text',
  'sql/char@1': 'sqlite/character',
  'sql/varchar@1': 'sqlite/character-varying',
  'sqlite/datetime@1': 'sqlite/datetime',
  'sqlite/datetime-temporal@1': 'sqlite/datetime',
  'sqlite/datetime-string@1': 'sqlite/datetime',
  'sqlite/date-string@1': 'sqlite/date',
  'sqlite/date-temporal@1': 'sqlite/date',
  'sqlite/time-string@1': 'sqlite/time',
  'sqlite/time-temporal@1': 'sqlite/time',
  'sqlite/duration-string@1': 'sqlite/duration',
  'sqlite/json@1': 'sqlite/json',
  'sqlite/blob@1': 'sqlite/blob',
  'sqlite/integer@1': 'sqlite/integer',
  'sql/int@1': 'sqlite/integer',
  'sqlite/bigint@1': 'sqlite/integer',
  'sqlite/bigintnumber@1': 'sqlite/integer',
  'sqlite/real@1': 'sqlite/real',
  'sql/float@1': 'sqlite/real',
  'sql/raw@1': 'sql/raw',
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
