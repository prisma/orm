import { describe, expect, it } from 'vitest';
import { mysqlDataTypeEntries } from '../src/core/data-type-entries';

const entries = mysqlDataTypeEntries();

describe('how PSL writes MySQL values', () => {
  it('reads a quoted string as mysql/text', () => {
    const entry = entries['mysql/text'];
    expect(
      entry?.written.kind === 'plain' && 'parse' in entry.written
        ? entry.written.parse('hi')
        : undefined,
    ).toBe('hi');
    expect(entry?.print('hi')).toBe('hi');
  });

  it('reads a whole number as the narrowest MySQL integer type that holds it', () => {
    const written = entries['mysql/bigint']?.written;
    const classify =
      written?.kind === 'plain' && 'classify' in written ? written.classify : undefined;
    expect([
      classify?.('42'),
      classify?.('3000000000'),
      classify?.('1.5'),
      classify?.('NaN'),
    ]).toEqual([
      { type: 'mysql/int', value: 42 },
      { type: 'mysql/bigint', value: '3000000000' },
      undefined,
      undefined,
    ]);
  });

  it('prints a number back as its numeral', () => {
    const print = entries['mysql/bigint']?.print;
    expect([print?.(42), print?.('3000000000')]).toEqual(['42', '3000000000']);
  });

  it.each([
    ['mysql/datetime', 'datetime', '2024-01-01 10:00:00.500', '2024-01-01T10:00:00.5'],
    ['mysql/timestamp', 'timestamp', '2024-01-01T10:00:00', '2024-01-01T10:00:00'],
    ['mysql/date', 'date', '2024-02-29', '2024-02-29'],
    ['mysql/time', 'time', '09:30', '09:30:00'],
    ['mysql/duration', 'duration', 'PT1H30M', 'PT1H30M'],
  ])('reads %s from its %s tag and prints it back', (id, tag, text, stored) => {
    const entry = entries[id];
    const written = entry?.written;
    expect(written?.kind === 'tag' ? [written.tag, written.parse(text)] : undefined).toEqual([
      tag,
      stored,
    ]);
    expect(entry?.print(stored)).toBe(stored);
  });

  it.each([
    ['mysql/timestamp', '1969-12-31T23:59:59'],
    ['mysql/date', '2024-02-30'],
    ['mysql/time', '25:00'],
    ['mysql/duration', 'an hour'],
  ])('refuses text %s does not take', (id, text) => {
    const written = entries[id]?.written;
    expect(() => (written?.kind === 'tag' ? written.parse(text) : undefined)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED' }),
    );
  });
});
