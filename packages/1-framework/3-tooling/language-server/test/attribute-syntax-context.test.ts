import { FunctionCallAst, parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { locateAttributeSyntax } from '../src/attribute-syntax-context';

function locate(args: string) {
  const source = `model Example { value String @probe(${args}) }`;
  const offset = source.indexOf('|');
  const { document, sourceFile } = parse(source.replace('|', ''));
  const context = locateAttributeSyntax({
    document,
    sourceFile,
    position: sourceFile.positionAt(offset),
  });
  expect(context).toBeDefined();
  return context;
}

describe('attribute argument syntax cursor', () => {
  it.each([
    { gap: '| ', containing: undefined, region: 'separator' },
    { gap: ' | ', containing: undefined, region: 'trivia' },
    { gap: ' |', containing: 'references', region: 'name' },
  ])(
    'retains the following argument across comma whitespace: $gap',
    ({ gap, containing, region }) => {
      const context = locate(`fields: [id],${gap}references: [id]`);
      const frame = context?.frames[0];
      expect(frame).toMatchObject({ kind: 'arguments', region });
      if (frame?.kind !== 'arguments') throw new Error('Missing argument frame');
      expect({
        containing: frame.containingArgument?.name()?.name(),
        preceding: frame.precedingArgument?.name()?.name(),
        following: frame.followingArgument?.name()?.name(),
        separator: context?.preceding?.kind,
      }).toEqual({ containing, preceding: 'fields', following: 'references', separator: 'Comma' });
    },
  );

  it.each([
    { args: 'references|: [id]', region: 'name' },
    { args: 'references: |[id]', region: 'value' },
  ])('distinguishes named keys and values: $args', ({ args, region }) => {
    const frame = locate(args)?.frames[0];
    expect(frame).toMatchObject({ kind: 'arguments', region });
    if (frame?.kind !== 'arguments') throw new Error('Missing argument frame');
    expect(frame.containingArgument?.name()?.name()).toBe('references');
  });

  it.each(['nested', 'unknown'])(
    'retains syntactic calls without resolving their names: %s',
    (name) => {
      const context = locate(`records: { item: [${name}(|)] }`);
      expect(context?.frames.map((frame) => frame.node.syntax.kind)).toEqual([
        'AttributeArgList',
        'ObjectLiteralExpr',
        'ArrayLiteral',
        'FunctionCall',
        'FunctionCall',
      ]);
      const frame = context?.frames.at(-1);
      expect(frame).toMatchObject({ kind: 'arguments', insideDelimiters: true });
      expect(
        frame?.node instanceof FunctionCallAst && frame.node.name()?.identifier()?.name(),
      ).toBe(name);
    },
  );

  it.each(['@probe(|', '@probe(call: unknown( |', '@probe(collection: [unknown( |'])(
    'retains unfinished delimiters: %s',
    (attribute) => {
      const source = `model Example { value String ${attribute}`;
      const offset = source.indexOf('|');
      const { document, sourceFile } = parse(source.replace('|', ''));
      const context = locateAttributeSyntax({
        document,
        sourceFile,
        position: sourceFile.positionAt(offset),
      });
      const frame = context?.frames.at(-1);
      expect(frame).toMatchObject({ kind: 'arguments', insideDelimiters: true });
      if (frame?.kind !== 'arguments') throw new Error('Missing argument frame');
      expect(frame.node.rparen()).toBeUndefined();
    },
  );
});
