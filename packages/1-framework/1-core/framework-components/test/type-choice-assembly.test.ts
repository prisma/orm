import { describe, expect, it } from 'vitest';
import type { CreateControlStackInput } from '../src/control/control-stack';
import { createControlStack } from '../src/control/control-stack';
import {
  type AuthoringTypeChoiceDescriptor,
  assertTypeChoicesValid,
} from '../src/shared/authoring-type-choice';
import type { AuthoringTypeNamespace } from '../src/shared/framework-authoring';

const precision = {
  kind: 'value',
  dataType: 'test/int',
  name: 'precision',
  optional: true,
} as const;

const asOption = {
  kind: 'option',
  name: 'as',
  values: ['date', 'text'],
  default: 'date',
  optional: true,
} as const;

const choice = (overrides: Partial<AuthoringTypeChoiceDescriptor> = {}) =>
  ({
    kind: 'typeChoice',
    args: [asOption, precision],
    choices: [
      { when: { as: 'date' }, type: 'WideDate', defaults: { precision: 3 } },
      { when: { as: 'text' }, type: 'WideText' },
    ],
    ...overrides,
  }) satisfies AuthoringTypeChoiceDescriptor;

const constructors = {
  WideDate: {
    kind: 'typeConstructor',
    args: [precision],
    output: { codecId: 'test/wide-date@1', typeParams: { precision: { kind: 'arg', index: 0 } } },
  },
  WideText: { kind: 'typeConstructor', output: { codecId: 'test/wide-text@1' } },
  Bounded: {
    kind: 'typeConstructor',
    args: [{ kind: 'value', dataType: 'test/int', name: 'length' }],
    output: { codecId: 'test/bounded@1', typeParams: { length: { kind: 'arg', index: 0 } } },
  },
} as const satisfies AuthoringTypeNamespace;

const check = (moment: AuthoringTypeChoiceDescriptor) => () =>
  assertTypeChoicesValid({ ...constructors, Moment: moment }, 'x-pack');

describe('assertTypeChoicesValid', () => {
  it('passes a choice whose rows name constructors of its namespace', () => {
    expect(check(choice())).not.toThrow();
  });

  it('refuses a choice naming a constructor only another component registers', () => {
    expect(() =>
      assertTypeChoicesValid({ Moment: choice(), WideText: constructors.WideText }, 'x-pack'),
    ).toThrow(
      'Type choice "Moment" contributed by "x-pack" chooses "WideDate", which is not a type constructor "x-pack" registers beside it.',
    );
  });

  it('refuses a row naming a constructor no component registers, naming the pack and the name', () => {
    expect(check(choice({ choices: [{ when: { as: 'date' }, type: 'Missing' }] }))).toThrow(
      'Type choice "Moment" contributed by "x-pack" chooses "Missing", which is not a type constructor "x-pack" registers beside it.',
    );
  });

  it('refuses a default no row matches', () => {
    expect(check(choice({ choices: [{ when: { as: 'text' }, type: 'WideText' }] }))).toThrow(
      'Type choice "Moment" contributed by "x-pack" has no row for its defaults as: date, so it cannot be written bare.',
    );
  });

  it('refuses a default the option does not list', () => {
    expect(
      check(
        choice({
          args: [{ kind: 'option', name: 'as', values: ['text'], default: 'date', optional: true }],
        }),
      ),
    ).toThrow(
      'Type choice "Moment" contributed by "x-pack" defaults option "as" to date, which it does not list.',
    );
  });

  it('refuses a row whose combination names a value an option does not list', () => {
    expect(
      check(
        choice({
          choices: [
            { when: { as: 'date' }, type: 'WideDate' },
            { when: { as: 'json' }, type: 'WideText' },
          ],
        }),
      ),
    ).toThrow(
      'Type choice "Moment" contributed by "x-pack" has a row for as: json, which does not give every option one of its values.',
    );
  });

  it('refuses a parameter default for an argument the choice does not pass on', () => {
    expect(
      check(
        choice({
          choices: [
            { when: { as: 'date' }, type: 'WideDate', defaults: { scale: 2 } },
            { when: { as: 'text' }, type: 'WideText' },
          ],
        }),
      ),
    ).toThrow(
      'Type choice "Moment" contributed by "x-pack" gives a default for "scale", which is not an argument it passes on.',
    );
  });

  it('refuses two rows for one combination', () => {
    expect(
      check(
        choice({
          choices: [
            { when: { as: 'date' }, type: 'WideDate' },
            { when: { as: 'text' }, type: 'WideText' },
            { when: { as: 'date' }, type: 'WideText' },
          ],
        }),
      ),
    ).toThrow(
      'Type choice "Moment" contributed by "x-pack" has two rows for as: date; each combination chooses one type.',
    );
  });

  it('refuses a parameter default the chosen constructor does not take', () => {
    expect(
      check(
        choice({
          choices: [
            { when: { as: 'date' }, type: 'WideDate' },
            { when: { as: 'text' }, type: 'WideText', defaults: { precision: 3 } },
          ],
        }),
      ),
    ).toThrow(
      'Type choice "Moment" contributed by "x-pack" gives a default for "precision" to "WideText", which takes no argument of that name.',
    );
  });

  it('refuses a passed-on argument of another data type than the chosen constructor takes', () => {
    expect(check(choice({ args: [asOption, { ...precision, dataType: 'test/text' }] }))).toThrow(
      'Type choice "Moment" contributed by "x-pack" passes "precision" as a value of data type "test/text" to "WideDate", which takes "test/int".',
    );
  });

  describe('a row naming a constructor with a required argument', () => {
    const length = { kind: 'value', dataType: 'test/int', name: 'length', optional: true } as const;
    const boundedRow = (defaults?: Record<string, number>) =>
      choice({
        args: [asOption, length],
        choices: [
          { when: { as: 'date' }, type: 'WideText' },
          { when: { as: 'text' }, type: 'Bounded', ...(defaults ? { defaults } : {}) },
        ],
      });

    it('refuses the row when the choice does not pass the argument on', () => {
      expect(
        check(
          choice({
            args: [asOption],
            choices: [
              { when: { as: 'date' }, type: 'WideText' },
              { when: { as: 'text' }, type: 'Bounded' },
            ],
          }),
        ),
      ).toThrow(
        'Type choice "Moment" contributed by "x-pack" has a row for as: text that chooses "Bounded", which requires "length", and gives it no default.',
      );
    });

    it('refuses the row when the choice passes the argument on as optional with no row default', () => {
      expect(check(boundedRow())).toThrow(
        'Type choice "Moment" contributed by "x-pack" has a row for as: text that chooses "Bounded", which requires "length", and gives it no default.',
      );
    });

    it('refuses the row when the required argument has no name a default could use', () => {
      expect(() =>
        assertTypeChoicesValid(
          {
            ...constructors,
            Unnamed: {
              kind: 'typeConstructor',
              args: [{ kind: 'value', dataType: 'test/int' }],
              output: { codecId: 'test/unnamed@1' },
            },
            Moment: choice({
              args: [asOption],
              choices: [
                { when: { as: 'date' }, type: 'WideText' },
                { when: { as: 'text' }, type: 'Unnamed' },
              ],
            }),
          },
          'x-pack',
        ),
      ).toThrow(
        'Type choice "Moment" contributed by "x-pack" has a row for as: text that chooses "Unnamed", which requires an unnamed argument 1, and gives it no default.',
      );
    });

    it('passes the row when it gives the argument a default', () => {
      expect(check(boundedRow({ length: 255 }))).not.toThrow();
    });
  });
});

describe('createControlStack', () => {
  it('refuses a type choice naming a constructor another component registers', () => {
    const input = {
      family: {
        kind: 'family',
        id: 'fam',
        version: '0.0.1',
        authoring: { type: { WideText: constructors.WideText } },
      },
      target: {
        kind: 'target',
        id: 'tgt',
        version: '0.0.1',
        authoring: {
          type: {
            Moment: choice({
              args: [asOption],
              choices: [
                { when: { as: 'date' }, type: 'WideText' },
                { when: { as: 'text' }, type: 'WideText' },
              ],
            }),
          },
        },
      },
      extensions: [],
    } as unknown as CreateControlStackInput;

    expect(() => createControlStack(input)).toThrow(
      'Type choice "Moment" contributed by "tgt" chooses "WideText", which is not a type constructor "tgt" registers beside it.',
    );
  });

  it('refuses a type choice naming a constructor no component registers', () => {
    const input = {
      family: { kind: 'family', id: 'fam', version: '0.0.1' },
      target: {
        kind: 'target',
        id: 'tgt',
        version: '0.0.1',
        authoring: {
          type: { Moment: choice({ choices: [{ when: { as: 'date' }, type: 'Missing' }] }) },
        },
      },
      extensions: [],
    } as unknown as CreateControlStackInput;

    expect(() => createControlStack(input)).toThrow(/"Moment" contributed by "tgt".*"Missing"/);
  });
});
