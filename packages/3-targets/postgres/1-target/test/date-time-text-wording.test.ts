import { describe, expect, it } from 'vitest';
import {
  errorDateStyleNotIso,
  errorTemporalUnavailable,
  errorTemporalUnavailableForDefault,
  errorTemporalUnrepresentable,
  errorTemporalWrongType,
} from '../src/core/errors';
import { postgresNativeAuthoringTypes } from '../src/core/type-constructors';

function wordingOf(error: { message: string; why?: string; fix?: string }): string {
  return [error.message, error.why ?? '', error.fix ?? ''].join(' ');
}

describe('the wording that sends a user to a text date or time type', () => {
  it.each([
    ['the missing Temporal error', errorTemporalUnavailable('pg/date-temporal@1', 'decode')],
    ['the missing Temporal error of a generator', errorTemporalUnavailableForDefault('instantNow')],
    [
      'the unrepresentable value error',
      errorTemporalUnrepresentable({
        codecId: 'pg/time-temporal@1',
        operation: 'decode',
        stringType: 'TimeString(p)',
        value: '24:00:00',
        detail: 'hour 24 is out of range',
      }),
    ],
    [
      'the wrong value type error',
      errorTemporalWrongType('pg/date-temporal@1', 'Temporal.PlainDate', 'DateString', 'a string'),
    ],
  ])('says %s reads ISO 8601 text', (_name, error) => {
    const wording = wordingOf(error);
    expect({
      iso: wording.includes('ISO 8601'),
      postgresText: /PostgreSQL('s own)? text/.test(wording),
    }).toEqual({
      iso: true,
      postgresText: false,
    });
  });

  it.each([
    ['a codec', errorTemporalUnavailable('pg/date-temporal@1', 'decode')],
    ['a generator', errorTemporalUnavailableForDefault('instantNow')],
  ])('sends the missing Temporal error of %s to the convenience defaults', (_name, error) => {
    expect(error.fix).toBe(
      'Run on a runtime with Temporal available, install a Temporal polyfill before creating the client, or write the column as a convenience type at its default, which needs no Temporal: `DateTime` reads a JavaScript `Date`, and `Date`, `Time` and `Duration` read ISO 8601 strings.',
    );
  });

  it('says the driver could not ensure DateStyle=ISO, names a pooler as one cause, and gives no advice to set startup options', () => {
    const error = errorDateStyleNotIso('pg/date-string@1', '02.01.2026');
    expect({
      couldNotEnsure: error.message.includes('the driver could not ensure'),
      pooler: (error.why ?? '').includes('pooler'),
      startupOptionAdvice: (error.fix ?? '').includes('options:'),
    }).toEqual({ couldNotEnsure: true, pooler: true, startupOptionAdvice: false });
  });

  it.each(['DateString', 'TimeString', 'TimestampString', 'TimestamptzString', 'Timetz'] as const)(
    'documents %s as ISO 8601 text',
    (name) => {
      expect(postgresNativeAuthoringTypes[name].documentation).toContain('ISO 8601');
    },
  );
});
