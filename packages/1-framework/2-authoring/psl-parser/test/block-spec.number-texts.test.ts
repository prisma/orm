import { describe, expect, it } from 'vitest';
import { jsonValue } from '../src/attribute-spec/combinators/json-value';
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
  const { symbolTable } = buildSymbolTable({ documents: [document], sources });
  const [block] = Object.values(symbolTable.topLevel.blocks);
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

describe('interpretExtensionBlock records the source text of number entries', () => {
  it('keeps every digit of a map entry written as a number literal, by key', () => {
    const parsed = interpretOnlyBlock(
      [
        'enum Big {',
        '  Huge     = 9007199254740993',
        '  Fraction = 0.12345678901234567890',
        '  Negative = -1',
        '  Text     = "9007199254740993"',
        '  Bare',
        '}',
      ].join('\n'),
      ENUM_DESCRIPTOR,
      enumSpec(),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect({ ...parsed.value.numberTexts }).toEqual({
      Huge: '9007199254740993',
      Fraction: '0.12345678901234567890',
      Negative: '-1',
    });
  });

  it('keeps the text of a struct entry written as a number literal, by key', () => {
    const parsed = interpretOnlyBlock(
      ['settings Main {', '  limit = 9223372036854775807', '  label = "x"', '}'].join('\n'),
      SETTINGS_DESCRIPTOR,
      settingsSpec(),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect({ ...parsed.value.numberTexts }).toEqual({ limit: '9223372036854775807' });
  });
});
