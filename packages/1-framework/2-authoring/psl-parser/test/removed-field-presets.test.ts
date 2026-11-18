import { describe, expect, it } from 'vitest';
import type { ContributedTypeNamespace } from '../src/contributed-type-scope';
import { parse } from '../src/parse';
import {
  describeRemovedFieldPreset,
  presetType,
  removedPresetWithPhases,
  removedPresetWrittenAs,
} from '../src/removed-field-presets';
import { PslSources } from '../src/source-file';
import { buildSymbolTable, type FieldSymbol } from '../src/symbol-table';

function callOf(type: string): FieldSymbol {
  const { document, sources } = parse(`model M {\n  f ${type}\n}\n`, 'schema.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources: new PslSources([[document.syntax, sources.sourceFileFor(document.syntax)]]),
    defaultNamespaceId: 'public',
  });
  const field = symbolTable.defaultNamespace.models['M']?.fields['f'];
  if (field?.typeConstructor === undefined) throw new Error(`${type} is not a call`);
  return field;
}

const stamp = { kind: 'typeConstructor', output: { codecId: 'test/stamp@1' } } as const;
const text = { kind: 'typeConstructor', output: { codecId: 'test/text@1' } } as const;
const moment = {
  kind: 'typeChoice',
  args: [
    { kind: 'option', name: 'as', values: ['stamp', 'text'], default: 'text', optional: true },
  ],
  choices: [
    { when: { as: 'stamp' }, type: 'Stamp' },
    { when: { as: 'text' }, type: 'Text' },
  ],
} as const;
const presets = {
  'ns.stamp': removedPresetWithPhases('Stamp', 'test/stamp@1', true),
  plain: removedPresetWrittenAs('Stamp', 'test/stamp@1', '@id'),
  either: [
    ...removedPresetWrittenAs('Stamp', 'test/stamp@1'),
    ...removedPresetWrittenAs('ns.Stamp', 'test/stamp@1'),
  ],
  chosen: removedPresetWithPhases(presetType('Moment', { as: 'stamp' }), 'test/stamp@1', true),
};

function describeCall(
  field: FieldSymbol,
  types: ContributedTypeNamespace,
  isDeclared: (name: string) => boolean = () => false,
) {
  return describeRemovedFieldPreset(presets, field, types, isDeclared);
}

describe('describeRemovedFieldPreset', () => {
  it('names the call and its rewrite', () => {
    expect(describeCall(callOf('ns.stamp(3, onUpdate: now)'), { Stamp: stamp })).toBe(
      'ns.stamp(3, onUpdate: now) was a field preset, and Prisma 8 removed field presets. Write Stamp(precision: 3) @onUpdate(now()).',
    );
    expect(describeCall(callOf('plain()'), { Stamp: stamp })).toBe(
      'plain() was a field preset, and Prisma 8 removed field presets. Write Stamp @id.',
    );
  });

  it('names a type choice called with options where that call resolves to the codec', () => {
    const types = { Moment: moment, Stamp: stamp, Text: text };
    expect([
      describeCall(callOf('chosen(3, onCreate: now)'), types),
      describeCall(callOf('chosen(onCreate: later)'), types),
    ]).toEqual([
      'chosen(3, onCreate: now) was a field preset, and Prisma 8 removed field presets. Write Moment(as: stamp, precision: 3) @onCreate(now()).',
      'chosen(onCreate: later) was a field preset, and Prisma 8 removed field presets. Write Moment(as: stamp, ...) with @onCreate(now()) and @onUpdate(now()) for the phases the preset set.',
    ]);
  });

  it('names nothing where the type choice call resolves to another codec', () => {
    const textOnly = {
      ...moment,
      choices: [{ when: { as: 'stamp' }, type: 'Text' }],
    } as const;
    expect(describeCall(callOf('chosen()'), { Moment: textOnly, Text: text })).toBeUndefined();
  });

  it.each([
    ['plain()?', 'Write Stamp? @id.'],
    ['plain()[]', 'Write Stamp[] @id.'],
    ['ns.stamp(3, onCreate: now)?', 'Write Stamp(precision: 3)? @onCreate(now()).'],
    [
      'ns.stamp(onCreate: later)[]',
      'Write Stamp(...)[] with @onCreate(now()) and @onUpdate(now()) for the phases the preset set.',
    ],
  ])('writes the modifier of %s right after the type, before the attributes', (type, rewrite) => {
    const call = type.replace(/(\?|\[\])$/, '');
    expect(describeCall(callOf(type), { Stamp: stamp })).toBe(
      `${call} was a field preset, and Prisma 8 removed field presets. ${rewrite}`,
    );
  });

  it('names nothing for a field not typed by a call', () => {
    const { typeConstructor: _, ...field } = callOf('plain()');
    expect(describeCall(field, { Stamp: stamp })).toBeUndefined();
  });

  it('names the rewrite of the first row that applies to the stack', () => {
    expect(
      describeCall(callOf('either()'), {
        Stamp: stamp,
        ns: { Stamp: stamp },
      }),
    ).toBe('either() was a field preset, and Prisma 8 removed field presets. Write Stamp.');
    expect(describeCall(callOf('either()'), { ns: { Stamp: stamp } })).toBe(
      'either() was a field preset, and Prisma 8 removed field presets. Write ns.Stamp.',
    );
  });

  it('skips a row whose type the schema declares a name for, which would bind the rewrite to it', () => {
    expect(
      describeCall(
        callOf('either()'),
        { Stamp: stamp, ns: { Stamp: stamp } },
        (name) => name === 'Stamp',
      ),
    ).toBe('either() was a field preset, and Prisma 8 removed field presets. Write ns.Stamp.');
    expect(
      describeCall(callOf('either()'), { Stamp: stamp, ns: { Stamp: stamp } }, () => true),
    ).toBeUndefined();
  });

  it('falls back to the phases sentence when the arguments do not bind', () => {
    expect(describeCall(callOf('ns.stamp(onUpdate: later)'), { Stamp: stamp })).toBe(
      'ns.stamp(onUpdate: later) was a field preset, and Prisma 8 removed field presets. Write Stamp(...) with @onCreate(now()) and @onUpdate(now()) for the phases the preset set.',
    );
  });

  it.each([
    ['the stack has no type the rewrite writes', 'plain()', {}],
    ['the stack has no type any row writes', 'either()', {}],
    [
      'the rewrite type stores another codec',
      'plain()',
      { Stamp: { kind: 'typeConstructor', output: { codecId: 'test/other@1' } } },
    ],
    ['the call names no removed preset', 'other()', { Stamp: stamp }],
    ['the call names an inherited property', 'constructor()', { Stamp: stamp }],
  ] as const)('names nothing when %s', (_, type, types) => {
    expect(describeCall(callOf(type), types)).toBeUndefined();
  });
});
