import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { createBinder } from '../src/binder';
import type { AttributeCtx } from '../src/exports';
import {
  bool,
  identifier,
  mapArg,
  numLiteral,
  oneOf,
  str,
  taggedLiteral,
  writtenList,
  writtenScalar,
} from '../src/exports';
import { Cursor, parseAttribute } from '../src/parse';
import { PslSources } from '../src/source-file';
import { FieldAttributeAst } from '../src/syntax/ast/attributes';
import type { ExpressionAst } from '../src/syntax/ast/expressions';
import { createSyntaxTree } from '../src/syntax/red';
import { binderContext } from './support';

function argOf(source: string): { expr: ExpressionAst; ctx: AttributeCtx } {
  const cursor = new Cursor('schema.prisma', `@x(${source})`);
  const root = createSyntaxTree(parseAttribute(cursor));
  const expr = [...(FieldAttributeAst.cast(root)?.argList()?.args() ?? [])][0]?.value();
  if (expr === undefined) throw new Error('expected an argument expression');
  const sources = new PslSources([[root, cursor.sourceFile]]);
  const symbols = {
    topLevel: { namespaces: {}, models: {}, compositeTypes: {}, namedTypes: {}, blocks: {} },
  };
  const { binder } = createBinder({
    sources,
    symbolTable: symbols,
    context: binderContext(),
  });
  return { expr, ctx: { sources, symbols, binder } };
}

/** The span of the argument `source`, which starts after `@x(` on the first line. */
function spanOf(source: string) {
  return {
    start: { offset: 3, line: 1, column: 4 },
    end: { offset: 3 + source.length, line: 1, column: 4 + source.length },
  };
}

const tag = taggedLiteral(['json'], { documentation: 'A JSON document.' });

describe('writtenScalar', () => {
  it('keeps the kind and metadata of the arm it wraps', () => {
    const wrapped = writtenScalar(tag);
    expect({
      kind: wrapped.kind,
      label: wrapped.label,
      tags: Reflect.get(wrapped, 'tags'),
      documentation: Reflect.get(wrapped, 'documentation'),
    }).toEqual({
      kind: 'taggedLiteral',
      label: 'json`...`',
      tags: ['json'],
      documentation: 'A JSON document.',
    });
  });

  it.each([
    ['a string', str(), '"x"', { kind: 'string', text: 'x' }],
    ['a number', numLiteral(), '-1.50', { kind: 'number', text: '-1.50' }],
    ['a boolean', bool(), 'false', { kind: 'boolean', value: false }],
    ['a tagged literal', tag, 'json`  [1]`', { kind: 'tag', tag: 'json', text: '[1]' }],
  ])('yields %s as a written scalar with its span', (_, arm, source, written) => {
    const { expr, ctx } = argOf(source);
    expect(writtenScalar(arm).parse(expr, ctx)).toEqual(
      ok({ kind: 'scalar', written, span: spanOf(source) }),
    );
  });

  it('yields why a tagged literal cannot be canonicalized, with its span', () => {
    const source = 'json`a\0b`';
    const { expr, ctx } = argOf(source);
    expect(writtenScalar(tag).parse(expr, ctx)).toEqual(
      ok({ kind: 'scalar', written: undefined, reason: 'nul', span: spanOf(source) }),
    );
  });

  it('returns the refusal of the arm it wraps', () => {
    const { expr, ctx } = argOf('true');
    expect(writtenScalar(str()).parse(expr, ctx)).toEqual(str().parse(expr, ctx));
  });
});

describe('writtenList', () => {
  const type = writtenList(writtenScalar(str()));

  it('is a list labelled by its element', () => {
    expect({ kind: type.kind, label: type.label }).toEqual({
      kind: 'list',
      label: 'list of (string)',
    });
  });

  it('yields its written elements and the span of the whole list', () => {
    const source = '["a", "b"]';
    const { expr, ctx } = argOf(source);
    const at = (offset: number, length: number) => ({
      start: { offset: 3 + offset, line: 1, column: 4 + offset },
      end: { offset: 3 + offset + length, line: 1, column: 4 + offset + length },
    });
    expect(type.parse(expr, ctx)).toEqual(
      ok({
        kind: 'list',
        elements: [
          { kind: 'scalar', written: { kind: 'string', text: 'a' }, span: at(1, 3) },
          { kind: 'scalar', written: { kind: 'string', text: 'b' }, span: at(6, 3) },
        ],
        span: spanOf(source),
      }),
    );
  });

  it('holds elements of any parsed shape its element arm yields', () => {
    const missing = mapArg(identifier('missing', { documentation: 'No value.' }), () => ({
      kind: 'missing' as const,
    }));
    const source = '["a", missing]';
    const { expr, ctx } = argOf(source);
    expect(writtenList(oneOf(writtenScalar(str()), missing)).parse(expr, ctx)).toEqual(
      ok({
        kind: 'list',
        elements: [
          {
            kind: 'scalar',
            written: { kind: 'string', text: 'a' },
            span: {
              start: { offset: 4, line: 1, column: 5 },
              end: { offset: 7, line: 1, column: 8 },
            },
          },
          { kind: 'missing' },
        ],
        span: spanOf(source),
      }),
    );
  });
});

describe('mapArg', () => {
  const member = identifier('Active', { documentation: 'The Active member.' });
  const mapped = mapArg(member, (name) => ({ kind: 'member', name }) as const);

  it('keeps the kind and metadata of the arm it maps', () => {
    expect({
      kind: mapped.kind,
      label: mapped.label,
      name: Reflect.get(mapped, 'name'),
      documentation: Reflect.get(mapped, 'documentation'),
    }).toEqual({
      kind: 'identifier',
      label: member.label,
      name: 'Active',
      documentation: 'The Active member.',
    });
  });

  it('maps the value the arm parses', () => {
    const { expr, ctx } = argOf('Active');
    expect(mapped.parse(expr, ctx)).toEqual(ok({ kind: 'member', name: 'Active' }));
  });

  it('passes the arm refusal through unchanged', () => {
    const { expr, ctx } = argOf('Other');
    expect(mapped.parse(expr, ctx)).toEqual(member.parse(expr, ctx));
  });

  it('gives the mapping the argument and the context', () => {
    const { expr, ctx } = argOf('Active');
    const withSpan = mapArg(member, (_name, arg) => arg.syntax.kind);
    expect(withSpan.parse(expr, ctx)).toEqual(ok(expr.syntax.kind));
  });
});
