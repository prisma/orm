import {
  collectScalarTypeConstructors,
  instantiateAuthoringTypeCall,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import {
  mongoAuthoringTypes,
  mongoConvenienceDateTimeTypes,
  mongoDateTimeTypeConstructors,
  mongoScalarTypeConstructors,
} from '../src/core/authoring';

describe('the explicit date and time types', () => {
  it('each name the codec it is', () => {
    expect(
      Object.fromEntries(collectScalarTypeConstructors(mongoDateTimeTypeConstructors)),
    ).toEqual({
      DateJsDate: { codecId: 'mongo/date@1' },
      DateInstant: { codecId: 'mongo/date-instant@1' },
      DateInstantString: { codecId: 'mongo/date-instant-string@1' },
      DateString: { codecId: 'mongo/date-string@1' },
      DateTemporal: { codecId: 'mongo/date-temporal@1' },
      TimeString: { codecId: 'mongo/time-string@1' },
      TimeTemporal: { codecId: 'mongo/time-temporal@1' },
      DurationString: { codecId: 'mongo/duration-string@1' },
    });
  });

  it.each([
    ...Object.entries(mongoDateTimeTypeConstructors),
    ...Object.entries(mongoConvenienceDateTimeTypes),
  ])('documents %s by the BSON type it is stored as', (_name, descriptor) => {
    expect(descriptor.documentation).toMatch(/stored as (a )?BSON (date|string)/);
  });
});

describe('the convenience date and time types', () => {
  it('give DateTime, Date, Time and Duration to type choices, none deprecated', () => {
    expect(
      Object.fromEntries(
        (['DateTime', 'Date', 'Time', 'Duration'] as const).map((name) => [
          name,
          [
            mongoScalarTypeConstructors[name].kind,
            'deprecated' in mongoScalarTypeConstructors[name],
          ],
        ]),
      ),
    ).toEqual({
      DateTime: ['typeChoice', false],
      Date: ['typeChoice', false],
      Time: ['typeChoice', false],
      Duration: ['typeChoice', false],
    });
  });

  it.each([
    ['DateTime', [], 'mongo/date@1'],
    ['DateTime', ['jsDate', 'date'], 'mongo/date@1'],
    ['DateTime', ['temporal'], 'mongo/date-instant@1'],
    ['DateTime', ['string'], 'mongo/date-instant-string@1'],
    ['Date', [], 'mongo/date-string@1'],
    ['Date', ['temporal', 'date'], 'mongo/date-temporal@1'],
    ['Time', [], 'mongo/time-string@1'],
    ['Time', ['temporal', 'string'], 'mongo/time-temporal@1'],
    ['Duration', [], 'mongo/duration-string@1'],
  ])('%s(%j) is the explicit type on %s', (name, args, codecId) => {
    expect(instantiateAuthoringTypeCall(mongoScalarTypeConstructors, name, args)).toEqual({
      codecId,
    });
  });

  it('keep a bare DateTime on mongo/date@1, where the temporal type aliases stay', () => {
    expect(instantiateAuthoringTypeCall(mongoScalarTypeConstructors, 'DateTime', [])).toEqual(
      mongoAuthoringTypes.temporal.CreatedAt.output.type,
    );
  });

  it.each([
    ['DateTime', ['instant']],
    ['DateTime', ['jsDate', 'string']],
    ['Date', ['jsDate']],
    ['Time', ['string', 'date']],
    ['Duration', ['temporal']],
  ])('refuse %s(%j), which no row lists', (name, args) => {
    expect(() => instantiateAuthoringTypeCall(mongoScalarTypeConstructors, name, args)).toThrow();
  });
});
