import { Temporal as otherTemporal } from 'temporal-polyfill/implementation';
import { describe, expect, it } from 'vitest';
import {
  type TemporalValue,
  temporalFromText,
  temporalToText,
  withoutUtcDesignator,
} from '../src/temporal-text';

describe('temporalFromText', () => {
  it('reads text with the implementation it is given', () => {
    const read = temporalFromText(otherTemporal, '2024-02-29', (temporal, text) =>
      temporal.PlainDate.from(text),
    );

    expect(read).toEqual({ kind: 'value', value: expect.any(otherTemporal.PlainDate) });
    expect(String(read.kind === 'value' && read.value)).toBe('2024-02-29');
  });

  it('returns why the parser refused the text, with the error it threw', () => {
    const error = new RangeError('no 30 February');
    const read = temporalFromText(Temporal, '2024-02-30', () => {
      throw error;
    });

    expect(read).toEqual({ kind: 'unreadable', detail: 'no 30 February', cause: error });
  });

  it('gives the text of a thrown value that is not an Error as the detail', () => {
    const read = temporalFromText(Temporal, 'x', () => {
      throw 'not a date';
    });

    expect(read).toEqual({ kind: 'unreadable', detail: 'not a date', cause: 'not a date' });
  });
});

describe('temporalToText', () => {
  it('writes a value of the expected kind as its own toString() text', () => {
    expect(temporalToText(Temporal.PlainDate.from('2024-02-29'), 'Temporal.PlainDate')).toEqual({
      kind: 'text',
      text: '2024-02-29',
    });
  });

  it('accepts a value made by another implementation', () => {
    expect(
      temporalToText(otherTemporal.Instant.from('2024-01-01T00:00:00Z'), 'Temporal.Instant'),
    ).toEqual({ kind: 'text', text: '2024-01-01T00:00:00Z' });
  });

  it('writes the text the given function makes', () => {
    expect(
      temporalToText(Temporal.Instant.from('2024-01-01T00:00:00Z'), 'Temporal.Instant', (value) =>
        withoutUtcDesignator(value.toString()),
      ),
    ).toEqual({ kind: 'text', text: '2024-01-01T00:00:00' });
  });

  it.each([
    [Temporal.Instant.from('2024-01-01T00:00:00Z'), 'a Temporal.Instant'],
    [new Date(0), 'a Date'],
    [null, 'null'],
    ['2024-01-01', 'a string'],
    [undefined, 'a undefined'],
    [{ toString: () => '2024-01-01' }, 'a object'],
  ])('refuses %s, a value of the wrong kind, describing it', (value, received) => {
    expect(temporalToText(asTemporalValue(value), 'Temporal.PlainDate')).toEqual({
      kind: 'wrong-type',
      received,
    });
  });

  it('refuses a value in a calendar other than ISO 8601, naming the calendar', () => {
    const date = Temporal.PlainDate.from('2024-02-29').withCalendar('gregory');

    expect(temporalToText(date, 'Temporal.PlainDate')).toEqual({
      kind: 'non-iso-calendar',
      calendarId: 'gregory',
    });
  });
});

describe('withoutUtcDesignator', () => {
  it.each([
    ['2024-01-01T00:00:00Z', '2024-01-01T00:00:00'],
    ['2024-01-01T00:00:00', '2024-01-01T00:00:00'],
    ['2024-01-01T00:00:00+01:00', '2024-01-01T00:00:00+01:00'],
  ])('writes %s as %s', (text, expected) => {
    expect(withoutUtcDesignator(text)).toBe(expected);
  });
});

function asTemporalValue(value: unknown): TemporalValue {
  return value as TemporalValue;
}
