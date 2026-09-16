import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import {
  argumentAtCursor,
  argumentSiblings,
  betweenDelimiters,
  locateAttributeSyntax,
  recoveredContainerContainsCursor,
} from '../src/attribute-syntax-context';

function locate(source: string) {
  const offset = source.indexOf('|');
  const { document, sourceFile } = parse(source.replace('|', ''));
  const cursor = locateAttributeSyntax({
    document,
    sourceFile,
    position: sourceFile.positionAt(offset),
  });
  if (cursor === undefined) throw new Error('Missing attribute');
  const args = cursor.attribute.argList();
  if (args === undefined) throw new Error('Missing arguments');
  return { cursor, args };
}

describe('attribute syntax helpers', () => {
  it.each([
    { attribute: '@pr|obe()', found: true },
    { attribute: '@probe(|)', found: true },
    { attribute: '@probe(First,  |', found: true },
    { attribute: '@probe()  |', found: false },
  ])(
    'locates names and open arguments but not closed trailing trivia: $attribute',
    ({ attribute, found }) => {
      const source = `model Example { value String ${attribute}`;
      const offset = source.indexOf('|');
      const { document, sourceFile } = parse(source.replace('|', ''));
      const result = locateAttributeSyntax({
        document,
        sourceFile,
        position: sourceFile.positionAt(offset),
      });
      expect(result?.attribute.name()?.identifier()?.name()).toBe(found ? 'probe' : undefined);
    },
  );

  it.each([
    { gap: '| ', selected: undefined, keys: ['fields', 'references'] },
    { gap: ' | ', selected: undefined, keys: ['fields', 'references'] },
    { gap: ' |', selected: 'references', keys: ['fields'] },
  ])('locates only the argument containing the cursor: $gap', ({ gap, selected, keys }) => {
    const { cursor, args } = locate(
      `model Example { value String @probe(fields: [id],${gap}references: [id]) }`,
    );
    const active = argumentAtCursor(cursor, args);
    expect(active?.name()?.name()).toBe(selected);
    expect(argumentSiblings(args, active, cursor.offset)).toEqual({
      precedingPositionalCount: 0,
      otherNamedKeys: keys,
    });
  });

  it('counts preceding positional arguments without counting the selected argument', () => {
    const { cursor, args } = locate(
      'model Example { value String @probe(First, S|econd, key: 1) }',
    );
    const active = argumentAtCursor(cursor, args);
    expect(active?.value()?.syntax.kind).toBe('Identifier');
    expect(argumentSiblings(args, active, cursor.offset)).toEqual({
      precedingPositionalCount: 1,
      otherNamedKeys: ['key'],
    });
  });

  it.each([
    { call: '|(value)', inside: false },
    { call: '(|value)', inside: true },
    { call: '(value|)', inside: true },
    { call: '(value)|', inside: false },
    { call: '(value |', inside: true },
  ])('checks delimiter boundaries: $call', ({ call, inside }) => {
    const { cursor, args } = locate(`model Example { value String @probe${call}`);
    expect(betweenDelimiters(cursor.offset, args.lparen(), args.rparen())).toBe(inside);
  });

  it.each([
    { value: '[First, |', recovered: true },
    { value: '{ item: First, |', recovered: true },
    { value: 'nested(First, |', recovered: true },
    { value: '[First] |', recovered: false },
    { value: 'nested(First) |', recovered: false },
    { value: 'First |', recovered: false },
  ])('extends only unfinished containers into trailing trivia: $value', ({ value, recovered }) => {
    const { cursor, args } = locate(`model Example { value String @probe(${value}`);
    const expression = args.args()[Symbol.iterator]().next().value?.value();
    expect(expression).toBeDefined();
    expect(recoveredContainerContainsCursor(expression, cursor.offset)).toBe(recovered);
  });
});
