import { instantiateAuthoringTypeCall } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { mysqlAuthoringTypes } from '../src/core/authoring';
import {
  mysqlConvenienceDateTimeTypes,
  mysqlDateTimeTypeConstructors,
  mysqlScalarTypeConstructors,
} from '../src/core/type-constructors';

const types = mysqlScalarTypeConstructors;

describe('the MySQL convenience date and time types', () => {
  it('give DateTime, Date, Time and Duration to type choices, not to explicit types', () => {
    expect(
      ['DateTime', 'Date', 'Time', 'Duration'].map(
        (name) => (types as Record<string, { readonly kind?: string }>)[name]?.kind,
      ),
    ).toEqual(['typeChoice', 'typeChoice', 'typeChoice', 'typeChoice']);
  });

  it.each([
    ['DateTime', [], 'mysql/datetime@1', { precision: 3 }],
    ['DateTime', ['jsDate', 'datetime', 6], 'mysql/datetime@1', { precision: 6 }],
    ['DateTime', ['temporal'], 'mysql/datetime-temporal@1', { precision: 6 }],
    ['DateTime', ['string'], 'mysql/datetime-string@1', { precision: 6 }],
    ['DateTime', ['jsDate', 'timestamp'], 'mysql/timestamp@1', { precision: 3 }],
    ['DateTime', ['temporal', 'timestamp'], 'mysql/timestamp-temporal@1', { precision: 6 }],
    ['DateTime', ['string', 'timestamp', 0], 'mysql/timestamp-string@1', { precision: 0 }],
    ['Date', [], 'mysql/date-string@1', undefined],
    ['Date', ['temporal'], 'mysql/date-temporal@1', undefined],
    ['Time', [], 'mysql/time-string@1', { precision: 6 }],
    ['Time', ['temporal', 'time', 3], 'mysql/time-temporal@1', { precision: 3 }],
    ['Duration', [], 'mysql/duration-string@1', undefined],
  ])('%s(%j) is the explicit type on %s', (name, args, codecId, typeParams) => {
    expect(instantiateAuthoringTypeCall(types, name, args)).toEqual({
      codecId,
      ...(typeParams === undefined ? {} : { typeParams }),
    });
  });

  it('keep a bare DateTime on datetime(3) read as a Date, the type DateTime named before, where the temporal type aliases stay', () => {
    expect(instantiateAuthoringTypeCall(types, 'DateTime', [])).toEqual(
      instantiateAuthoringTypeCall(types, 'DatetimeJsDate', [3]),
    );
    expect(instantiateAuthoringTypeCall(types, 'DateTime', [])).toEqual(
      mysqlAuthoringTypes.temporal.CreatedAt.output.type,
    );
  });

  it('give each explicit type with a precision the precision written, and none when none is', () => {
    expect([
      instantiateAuthoringTypeCall(types, 'DatetimeTemporal', []),
      instantiateAuthoringTypeCall(types, 'TimeString', [2]),
    ]).toEqual([
      { codecId: 'mysql/datetime-temporal@1' },
      { codecId: 'mysql/time-string@1', typeParams: { precision: 2 } },
    ]);
  });

  it.each([
    ['DateTime', ['instant']],
    ['DateTime', ['jsDate', 'date']],
    ['Date', ['jsDate']],
    ['Duration', ['temporal']],
    ['Time', ['string', 'timetz']],
  ])('refuse %s(%j), which no row lists', (name, args) => {
    expect(() => instantiateAuthoringTypeCall(types, name, args)).toThrow();
  });

  it('mark as inferred only the type each convenience type gives with no arguments', () => {
    expect(
      Object.entries(mysqlDateTimeTypeConstructors)
        .filter(([, descriptor]) => 'inferred' in descriptor)
        .map(([name]) => name),
    ).toEqual(['DatetimeJsDate', 'TimestampJsDate', 'DateString', 'TimeString', 'DurationString']);
  });

  it.each([
    ...Object.entries(mysqlDateTimeTypeConstructors),
    ...Object.entries(mysqlConvenienceDateTimeTypes),
    ...Object.entries(mysqlAuthoringTypes.temporal),
  ])('documents %s', (_name, descriptor) => {
    expect(descriptor).toHaveProperty('documentation', expect.stringMatching(/\S.+/));
  });
});

describe('the MySQL temporal type aliases', () => {
  it('set now() on a bare DateTime, on create and on update', () => {
    const now = { name: 'now', args: {} };
    const type = { codecId: 'mysql/datetime@1', typeParams: { precision: 3 } };
    const { CreatedAt, UpdatedAt } = mysqlAuthoringTypes.temporal;
    expect([CreatedAt.output, UpdatedAt.output]).toEqual([
      { type, onCreate: now },
      { type, onCreate: now, onUpdate: now },
    ]);
  });
});
