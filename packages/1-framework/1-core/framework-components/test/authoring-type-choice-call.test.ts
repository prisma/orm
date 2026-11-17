import { describe, expect, it } from 'vitest';
import { findAuthoringTypeChoiceCall } from '../src/shared/authoring-type-choice-call';
import type { AuthoringTypeConstructorOutput } from '../src/shared/authoring-type-constructor-call';
import type { AuthoringTypeNamespace } from '../src/shared/framework-authoring';

const precision = {
  kind: 'value',
  dataType: 'test/int',
  name: 'precision',
  optional: true,
} as const;

const constructors = {
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
  WideTemporal: {
    kind: 'typeConstructor',
    args: [precision],
    output: {
      codecId: 'test/wide-temporal@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
} as const satisfies AuthoringTypeNamespace;

const moment = {
  kind: 'typeChoice',
  args: [
    { kind: 'option', name: 'value', values: ['date', 'text'], default: 'date', optional: true },
    {
      kind: 'option',
      name: 'column',
      values: ['wide', 'narrow'],
      default: 'wide',
      optional: true,
    },
    precision,
  ],
  choices: [
    { when: { value: 'date', column: 'wide' }, type: 'WideDate', defaults: { precision: 3 } },
    { when: { value: 'text', column: 'wide' }, type: 'WideText' },
    { when: { value: 'date', column: 'narrow' }, type: 'NarrowDate' },
  ],
} as const;

const namespace = { ...constructors, Moment: moment } as const satisfies AuthoringTypeNamespace;

const find = (
  path: readonly string[],
  args: readonly unknown[],
  types: AuthoringTypeNamespace = namespace,
) => findAuthoringTypeChoiceCall({ namespace: types, call: { path, args } });

describe('findAuthoringTypeChoiceCall', () => {
  it('writes the default row bare when its parameter is the row default', () => {
    expect(find(['WideDate'], [3])).toEqual({
      path: ['Moment'],
      args: [],
      becomes: { path: ['WideDate'], args: [3] },
    });
  });

  it('writes only the arguments that differ from the defaults, by name', () => {
    expect(find(['WideText'], [2])).toEqual({
      path: ['Moment'],
      args: [
        { name: 'value', value: 'text' },
        { name: 'precision', value: 2 },
      ],
      becomes: { path: ['WideText'], args: [2] },
    });
  });

  it('writes a parameter that differs from the row default', () => {
    expect(find(['WideDate'], [6])).toEqual({
      path: ['Moment'],
      args: [{ name: 'precision', value: 6 }],
      becomes: { path: ['WideDate'], args: [6] },
    });
  });

  it('writes the option of a row other than the default', () => {
    expect(find(['NarrowDate'], [])).toEqual({
      path: ['Moment'],
      args: [{ name: 'column', value: 'narrow' }],
      becomes: { path: ['NarrowDate'], args: [] },
    });
  });

  it('finds nothing for a constructor no row names', () => {
    expect(find(['WideTemporal'], [3])).toBeUndefined();
  });

  it('finds nothing when no call reproduces the parameters, as a row default would fill an omitted one', () => {
    expect(find(['WideDate'], [])).toBeUndefined();
  });

  it('finds nothing for a name that is not a type constructor', () => {
    expect(find(['Moment'], [])).toBeUndefined();
  });

  it('drops an argument whose omission the comparison counts as the same output', () => {
    const omittedPrecisionIsSix = (
      produced: AuthoringTypeConstructorOutput,
      wanted: AuthoringTypeConstructorOutput,
    ) =>
      produced.codecId === wanted.codecId &&
      (produced.typeParams?.['precision'] ?? 6) === (wanted.typeParams?.['precision'] ?? 6);
    expect(
      findAuthoringTypeChoiceCall({
        namespace,
        call: { path: ['WideText'], args: [6] },
        sameOutput: omittedPrecisionIsSix,
      }),
    ).toEqual({
      path: ['Moment'],
      args: [{ name: 'value', value: 'text' }],
      becomes: { path: ['WideText'], args: [] },
    });
    expect(
      findAuthoringTypeChoiceCall({
        namespace,
        call: { path: ['WideDate'], args: [6] },
        sameOutput: omittedPrecisionIsSix,
      }),
    ).toEqual({
      path: ['Moment'],
      args: [{ name: 'precision', value: 6 }],
      becomes: { path: ['WideDate'], args: [6] },
    });
  });

  it('takes the first type choice in namespace order that names the constructor', () => {
    const second = {
      ...moment,
      choices: [{ when: { value: 'text', column: 'wide' }, type: 'WideDate' }],
    };
    expect(find(['WideDate'], [3], { ...constructors, Moment: moment, Other: second })).toEqual({
      path: ['Moment'],
      args: [],
      becomes: { path: ['WideDate'], args: [3] },
    });
  });

  it('passes over a type choice that names the constructor but cannot reproduce the call', () => {
    const fixed = {
      kind: 'typeChoice',
      args: [{ kind: 'option', name: 'value', values: ['date'], default: 'date', optional: true }],
      choices: [{ when: { value: 'date' }, type: 'WideDate', defaults: { precision: 6 } }],
    } as const;
    expect(find(['WideDate'], [3], { ...constructors, Fixed: fixed, Moment: moment })).toEqual({
      path: ['Moment'],
      args: [],
      becomes: { path: ['WideDate'], args: [3] },
    });
  });

  it('writes a type choice of the same sub-namespace as the constructor', () => {
    expect(find(['pg', 'NarrowDate'], [], { pg: namespace })).toEqual({
      path: ['pg', 'Moment'],
      args: [{ name: 'column', value: 'narrow' }],
      becomes: { path: ['pg', 'NarrowDate'], args: [] },
    });
  });
});
