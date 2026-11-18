import { describe, expect, it } from 'vitest';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { createComposedAuthoringHelpers } from '../src/composed-authoring-helpers';
import { familyPack, targetPack } from './helpers/type-choice-packs';

const { type } = createComposedAuthoringHelpers({
  ...testTypeLookups,
  family: familyPack,
  target: targetPack,
});

const untyped = type.Moment as (...args: readonly unknown[]) => unknown;

describe('a type.* helper of a type choice', () => {
  it('gives what the helper of the type it chooses gives, for each row', () => {
    expect({
      bare: type.Moment(),
      empty: type.Moment({}),
      precision: type.Moment({ precision: 6 }),
      local: type.Moment({ storage: 'local', precision: 6 }),
      string: type.Moment({ as: 'string', storage: 'local' }),
      date: type.Moment({ as: 'date', storage: 'local' }),
      day: type.Day(),
      temporalDay: type.Day({ as: 'temporal' }),
    }).toEqual({
      bare: type.TimestamptzTemporal(3),
      empty: type.TimestamptzTemporal(3),
      precision: type.TimestamptzTemporal(6),
      local: type.TimestampTemporal(6),
      string: type.TimestampString(),
      date: type.DateString(),
      day: type.DateString(),
      temporalDay: type.DateTemporal(),
    });
  });

  it('gives the explicit codec and parameters', () => {
    expect(type.Moment()).toEqual({
      kind: 'codec-instance',
      codecId: 'pg/timestamptz-temporal@1',
      typeParams: { precision: 3 },
    });
  });

  it('reads an argument written as undefined as left out', () => {
    expect(type.Moment({ as: undefined, precision: undefined })).toEqual(
      type.TimestamptzTemporal(3),
    );
  });

  it('refuses an unlisted combination at the argument that makes it invalid', () => {
    expect(() => untyped({ as: 'string' })).toThrow(
      'Argument "storage" of Moment cannot be tz with as: string; write one of: local.',
    );
  });

  it('refuses a value the option does not list', () => {
    expect(() => untyped({ as: 'jsDate' })).toThrow(
      'Argument "as" of Moment is jsDate; write one of: temporal, string, date.',
    );
  });

  it('refuses an argument the chosen type does not take', () => {
    expect(() => untyped({ as: 'date', storage: 'local', precision: 3 })).toThrow(
      'Argument "precision" of Moment does not apply to DateString, the type that as: date, storage: local chooses.',
    );
  });

  it.each([
    ['positional arguments', ['string', 'local']],
    ['a string', ['string']],
    ['a list', [['string']]],
    ['null', [null]],
  ])('refuses %s in place of one object', (_, args) => {
    expect(() => untyped(...args)).toThrow(
      "Moment takes its arguments as one object with the keys as, storage and precision, such as Moment({ as: 'temporal' }).",
    );
  });

  it('refuses an argument the type choice does not have', () => {
    expect(() => untyped({ value: 'string' })).toThrow(
      'Moment has no argument "value"; its arguments are as, storage and precision.',
    );
  });
});

describe('composing helpers for a pack with a type choice', () => {
  it('refuses a choice naming a constructor no pack registers', () => {
    const broken = {
      ...targetPack,
      authoring: {
        type: {
          Moment: {
            ...targetPack.authoring.type.Moment,
            choices: [{ when: { as: 'temporal', storage: 'tz' }, type: 'Missing' }],
          },
        },
      },
    } as const;
    expect(() =>
      createComposedAuthoringHelpers({ ...testTypeLookups, family: familyPack, target: broken }),
    ).toThrow(/Type choice "Moment" contributed by "postgres" chooses "Missing"/);
  });
});
