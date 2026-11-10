import type { JsonValue } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

/** A stored value of each data type. */
const storedValues: Readonly<Record<string, JsonValue>> = {
  'sqlite/character': 'a',
  'sqlite/character-varying': 'low',
  'sqlite/text': 'low',
  'sqlite/integer': '1',
  'sqlite/real': 1.5,
  'sqlite/blob': '68656C6C6F',
  'sqlite/datetime': '2024-01-01T00:00:00.000Z',
  'sqlite/date': '2024-02-29',
  'sqlite/time': '09:30:00.000',
  'sqlite/duration': 'PT1H30M',
  'sqlite/json': '"x"',
};

describe('the literal each registered codec renders', () => {
  it('is pinned for a stored value of its data type', () => {
    const rendered = Object.fromEntries(
      codecDescriptors.map((descriptor) => [
        descriptor.codecId,
        descriptor.renderValueLiteral?.(storedValues[descriptor.dataType] ?? null, 'output'),
      ]),
    );

    expect(rendered).toEqual({
      'sql/char@1': '"a"',
      'sql/varchar@1': '"low"',
      'sql/int@1': '1',
      'sql/float@1': '1.5',
      'sqlite/text@1': '"low"',
      'sqlite/integer@1': '1',
      'sqlite/real@1': '1.5',
      'sqlite/blob@1': undefined,
      'sqlite/datetime@1': undefined,
      'sqlite/datetime-temporal@1': undefined,
      'sqlite/datetime-string@1': '"2024-01-01T00:00:00.000Z"',
      'sqlite/date-string@1': '"2024-02-29"',
      'sqlite/date-temporal@1': undefined,
      'sqlite/time-string@1': '"09:30:00.000"',
      'sqlite/time-temporal@1': undefined,
      'sqlite/duration-string@1': '"PT1H30M"',
      'sqlite/json@1': '"x"',
      'sqlite/bigint@1': '1n',
      'sqlite/bigintnumber@1': '1',
    });
  });

  it.each([
    ['sql/float@1', 'Infinity'],
    ['sqlite/real@1', '-Infinity'],
    ['sqlite/integer@1', 1],
    ['sqlite/bigint@1', '1.5'],
    ['sqlite/json@1', '{"a":1}'],
    ['sqlite/json@1', '"not JSON'],
  ])('%s renders nothing for the stored value %j, which has no literal type', (codecId, value) => {
    const descriptor = codecDescriptors.find((candidate) => candidate.codecId === codecId);
    expect(descriptor?.renderValueLiteral?.(value, 'output')).toBeUndefined();
  });
});
