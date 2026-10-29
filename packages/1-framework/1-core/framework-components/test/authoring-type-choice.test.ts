import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  collectScalarTypeConstructors,
  instantiateAuthoringTypeCall,
  resolveAuthoringTypeChoice,
  typeChoiceArgumentsFromObject,
  typeConstructorLookup,
} from '../src/shared/authoring-type-choice';
import {
  type AuthoringTypeConstructorDescriptor,
  type AuthoringTypeNamespace,
  validateAuthoringTypeChoiceParams,
} from '../src/shared/framework-authoring';

const precision = {
  kind: 'value',
  dataType: 'test/int',
  name: 'precision',
  optional: true,
} as const;

const namespace = {
  Moment: {
    kind: 'typeChoice',
    args: [
      { kind: 'option', name: 'as', values: ['date', 'text'], default: 'date', optional: true },
      {
        kind: 'option',
        name: 'storage',
        values: ['wide', 'narrow'],
        default: 'wide',
        optional: true,
      },
      precision,
    ],
    choices: [
      { when: { as: 'date', storage: 'wide' }, type: 'WideDate', defaults: { precision: 3 } },
      { when: { as: 'text', storage: 'wide' }, type: 'WideText' },
      { when: { as: 'date', storage: 'narrow' }, type: 'NarrowDate' },
    ],
  },
  WideDate: {
    kind: 'typeConstructor',
    args: [precision],
    output: { codecId: 'test/wide-date@1', typeParams: { precision: { kind: 'arg', index: 0 } } },
  },
  WideText: {
    kind: 'typeConstructor',
    args: [precision],
    output: { codecId: 'test/wide-text@1', typeParams: { precision: { kind: 'arg', index: 0 } } },
  },
  NarrowDate: {
    kind: 'typeConstructor',
    output: { codecId: 'test/narrow-date@1' },
  },
} as const satisfies AuthoringTypeNamespace;

const resolve = (args: readonly unknown[]) =>
  resolveAuthoringTypeChoice({
    helperPath: 'Moment',
    descriptor: namespace.Moment,
    args,
    constructorNamed: typeConstructorLookup(namespace),
  });

function refusal(args: readonly unknown[]) {
  try {
    resolve(args);
  } catch (error) {
    const { message, details } = error as { message: string; details: unknown };
    return { message, details };
  }
  throw new Error('expected a refusal');
}

describe('resolveAuthoringTypeChoice', () => {
  it('chooses the default row, with its parameter defaults, for a bare call', () => {
    expect(resolve([])).toEqual({
      type: 'WideDate',
      descriptor: namespace.WideDate,
      args: [3],
    });
  });

  it('reads option arguments by position', () => {
    expect(resolve(['text'])).toMatchObject({ type: 'WideText', args: [undefined] });
  });

  it('fills an option argument left out before a written one with its default', () => {
    expect(resolve([undefined, 'narrow'])).toMatchObject({ type: 'NarrowDate', args: [] });
  });

  it('passes a written argument on by name, over the row default', () => {
    expect(resolve(['date', undefined, 6])).toMatchObject({ type: 'WideDate', args: [6] });
  });

  it('refuses a value the option does not list, at that argument, naming its values', () => {
    expect(refusal(['bogus'])).toEqual({
      message: 'Argument "as" of Moment is bogus; write one of: date, text.',
      details: { helperPath: 'Moment', argumentIndex: 0 },
    });
  });

  it('refuses an unlisted combination at the argument that makes it invalid, naming what it accepts', () => {
    expect(refusal(['text', 'narrow'])).toEqual({
      message: 'Argument "storage" of Moment cannot be narrow with as: text; write one of: wide.',
      details: { helperPath: 'Moment', argumentIndex: 1 },
    });
  });

  it('refuses a passed-on argument the chosen type does not take', () => {
    expect(refusal([undefined, 'narrow', 6])).toEqual({
      message:
        'Argument "precision" of Moment does not apply to NarrowDate, the type that as: date, storage: narrow chooses.',
      details: { helperPath: 'Moment', argumentIndex: 2 },
    });
  });
});

describe('typeChoiceArgumentsFromObject', () => {
  const fromObject = (written: readonly unknown[]) =>
    typeChoiceArgumentsFromObject('Moment', namespace.Moment, written);

  it('gives the values by the argument positions of the choice, undefined where left out', () => {
    expect({
      none: fromObject([]),
      empty: fromObject([{}]),
      some: fromObject([{ precision: 6, as: 'text' }]),
    }).toEqual({
      none: [undefined, undefined, undefined],
      empty: [undefined, undefined, undefined],
      some: ['text', undefined, 6],
    });
  });

  it.each([
    ['positional arguments', ['text', 'wide']],
    ['a string', ['text']],
    ['a list', [['text']]],
    ['null', [null]],
  ])('refuses %s in place of one object', (_, written) => {
    expect(() => fromObject(written)).toThrow(
      "Moment takes its arguments as one object with the keys as, storage and precision, such as Moment({ as: 'date' }).",
    );
  });

  it('refuses a key the choice has no argument for', () => {
    expect(() => fromObject([{ as: 'text', value: 'text' }])).toThrow(
      'Moment has no argument "value"; its arguments are as, storage and precision.',
    );
  });
});

describe('a type choice in the type namespace', () => {
  it('instantiates to the column its chosen constructor makes', () => {
    expect(instantiateAuthoringTypeCall(namespace, 'Moment', ['text', undefined, 6])).toEqual({
      codecId: 'test/wide-text@1',
      typeParams: { precision: 6 },
    });
  });

  it('is a scalar, written bare as its default choice', () => {
    expect(collectScalarTypeConstructors(namespace).get('Moment')).toEqual({
      codecId: 'test/wide-date@1',
      typeParams: { precision: 3 },
    });
  });
});

describe('validateAuthoringTypeChoiceParams', () => {
  const paramsSchema = type({ 'precision?': 'number <= 6' });
  const check = (
    chosen: AuthoringTypeConstructorDescriptor,
    typeParams: Record<string, unknown>,
  ) => {
    try {
      validateAuthoringTypeChoiceParams(
        'Moment',
        namespace.Moment,
        chosen,
        typeParams,
        paramsSchema,
      );
    } catch (error) {
      const { message, details } = error as { message: string; details: unknown };
      return { message, details };
    }
    return undefined;
  };

  it('passes parameters the codec accepts', () => {
    expect(check(namespace.WideDate, { precision: 6 })).toBeUndefined();
  });

  it('names the argument of the choice a refused parameter came from', () => {
    expect(check(namespace.WideDate, { precision: 7 })).toEqual({
      message: expect.stringMatching(
        /^Argument "precision" of Moment is invalid: precision must be/,
      ),
      details: { helperPath: 'Moment', argumentIndex: 2 },
    });
  });

  it('names the type parameters when a refused parameter came from no argument', () => {
    const fixed: AuthoringTypeConstructorDescriptor = {
      kind: 'typeConstructor',
      output: { codecId: 'test/fixed@1', typeParams: { precision: 9 } },
    };
    expect(check(fixed, { precision: 9 })).toEqual({
      message: expect.stringMatching(
        /^The type parameters of Moment are invalid: precision must be/,
      ),
      details: { helperPath: 'Moment' },
    });
  });
});
