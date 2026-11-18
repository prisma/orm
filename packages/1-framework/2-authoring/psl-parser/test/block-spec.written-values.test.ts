import { describe, expect, it } from 'vitest';
import { jsonValue } from '../src/attribute-spec/combinators/json-value';
import { EMPTY_DATA_TYPES } from '../src/attribute-spec/spec-context';
import { mapBlock, structBlock } from '../src/block-spec/constructors';
import type { PslBlockSpecDescriptor } from '../src/block-spec/descriptor';
import { interpretExtensionBlock } from '../src/block-spec/interpret';
import type { BlockSpec } from '../src/block-spec/types';
import { parse } from '../src/parse';
import { buildSymbolTable } from '../src/symbol-table';
import { supportBinder } from './support';

function interpretOnlyBlock<S extends BlockSpec<unknown>>(
  source: string,
  descriptor: PslBlockSpecDescriptor,
  spec: S,
) {
  const { document, sources } = parse(source, 'test.psl');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    defaultNamespaceId: 'public',
  });
  const [block] = Object.values(symbolTable.defaultNamespace.blocks);
  if (block === undefined) throw new Error('expected one block in the symbol table');
  return interpretExtensionBlock({
    block,
    descriptor,
    spec,
    symbols: symbolTable,
    sources,
    binder: supportBinder({
      sources,
      symbolTable,
      pslBlockDescriptors: { [descriptor.keyword]: descriptor },
    }),
    dataTypes: EMPTY_DATA_TYPES,
  });
}

const enumSpec = () =>
  mapBlock({
    value: { type: jsonValue(), documentation: 'The explicit member value.' },
    allowBare: true,
  });

const ENUM_DESCRIPTOR = {
  kind: 'pslBlock',
  keyword: 'enum',
  discriminator: 'fixture-enum',
  name: { required: true },
  spec: enumSpec,
} satisfies PslBlockSpecDescriptor;

const settingsSpec = () =>
  structBlock({
    parameters: {
      limit: { type: jsonValue(), documentation: 'A number setting.' },
      label: { type: jsonValue(), documentation: 'A text setting.' },
    },
  });

const SETTINGS_DESCRIPTOR = {
  kind: 'pslBlock',
  keyword: 'settings',
  discriminator: 'fixture-settings',
  name: { required: true },
  spec: settingsSpec,
} satisfies PslBlockSpecDescriptor;

describe('interpretExtensionBlock records each literal entry as it is written', () => {
  it('keeps the syntax and every digit of each literal map entry, by key', () => {
    const parsed = interpretOnlyBlock(
      [
        'enum Big {',
        '  Huge     = 9007199254740993',
        '  Fraction = 0.12345678901234567890',
        '  Negative = -1',
        '  Positive = +2',
        '  Text     = "9007199254740993"',
        '  Bare',
        '}',
      ].join('\n'),
      ENUM_DESCRIPTOR,
      enumSpec(),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect({ ...parsed.value.writtenValues }).toEqual({
      Huge: { kind: 'number', text: '9007199254740993' },
      Fraction: { kind: 'number', text: '0.12345678901234567890' },
      Negative: { kind: 'number', text: '-1' },
      Positive: { kind: 'number', text: '+2' },
      Text: { kind: 'string', text: '9007199254740993' },
    });
  });

  it('keeps a list of literals as a written list, and leaves out a list holding anything else', () => {
    const parsed = interpretOnlyBlock(
      [
        'enum Vectors {',
        '  Unit  = [1, 2.5, -0, "x", true]',
        '  Empty = []',
        '  Mixed = [1, {}]',
        '}',
      ].join('\n'),
      ENUM_DESCRIPTOR,
      enumSpec(),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect({ ...parsed.value.writtenValues }).toEqual({
      Unit: {
        kind: 'list',
        elements: [
          { kind: 'number', text: '1' },
          { kind: 'number', text: '2.5' },
          { kind: 'number', text: '-0' },
          { kind: 'string', text: 'x' },
          { kind: 'boolean', value: true },
        ],
      },
      Empty: { kind: 'list', elements: [] },
    });
  });

  it('keeps each literal struct entry as it is written, by key', () => {
    const parsed = interpretOnlyBlock(
      ['settings Main {', '  limit = 9223372036854775807', '  label = "x"', '}'].join('\n'),
      SETTINGS_DESCRIPTOR,
      settingsSpec(),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect({ ...parsed.value.writtenValues }).toEqual({
      limit: { kind: 'number', text: '9223372036854775807' },
      label: { kind: 'string', text: 'x' },
    });
  });
});
