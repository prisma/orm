import { describe, expect, it } from 'vitest';
import { json } from '../src/attribute-spec/combinators/json';
import { jsonValue } from '../src/attribute-spec/combinators/json-value';
import type { AttributeCtx } from '../src/attribute-spec/types';
import { Cursor, parseAttribute } from '../src/parse';
import { PslSources } from '../src/source-file';
import { FieldAttributeAst } from '../src/syntax/ast/attributes';
import type { ExpressionAst } from '../src/syntax/ast/expressions';
import { createSyntaxTree } from '../src/syntax/red';
import { ownEntry } from './support';

function argOf(exprSource: string): { expr: ExpressionAst; ctx: AttributeCtx } {
  const cursor = new Cursor('schema.prisma', `@x(${exprSource})`);
  const root = createSyntaxTree(parseAttribute(cursor));
  const node = FieldAttributeAst.cast(root);
  if (!node) throw new Error('expected a field attribute');
  const first = [...(node.argList()?.args() ?? [])][0];
  const expr = first?.value();
  if (!expr) throw new Error('expected an argument expression');
  return {
    expr,
    ctx: {
      sources: new PslSources([[root, cursor.sourceFile]]),
      symbols: {
        topLevel: { namespaces: {}, models: {}, compositeTypes: {}, namedTypes: {}, blocks: {} },
      },
    },
  };
}

function parseJsonValue(exprSource: string) {
  const { expr, ctx } = argOf(exprSource);
  return jsonValue().parse(expr, ctx);
}

function expectValue(exprSource: string, value: unknown): void {
  const result = parseJsonValue(exprSource);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual(value);
}

describe('jsonValue', () => {
  it('reads scalar literals natively', () => {
    expectValue('"hello"', 'hello');
    expectValue('42', 42);
    expectValue('-1.5', -1.5);
    expectValue('true', true);
    expectValue('false', false);
  });

  it('reads the null identifier as JSON null', () => {
    expectValue('null', null);
  });

  it('decodes string escapes through the AST, not through JSON.parse', () => {
    expectValue('"line\\nbreak \\"quoted\\""', 'line\nbreak "quoted"');
  });

  it('reads nested arrays and objects recursively', () => {
    expectValue('{ name: "a", sizes: [1, 2, [3]], nested: { flag: true, none: null } }', {
      name: 'a',
      sizes: [1, 2, [3]],
      nested: { flag: true, none: null },
    });
  });

  it('reads string-literal object keys', () => {
    expectValue('{ "quoted key": 1 }', { 'quoted key': 1 });
  });

  it('rejects a non-null identifier', () => {
    const result = parseJsonValue('bareWord');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Expected a JSON value, found identifier "bareWord"',
      }),
    ]);
  });

  it('rejects a function call', () => {
    const result = parseJsonValue('uuid()');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual([expect.objectContaining({ message: 'Expected a JSON value' })]);
  });

  it('rejects a tagged literal', () => {
    const result = parseJsonValue('pg.sql`now()`');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual([expect.objectContaining({ message: 'Expected a JSON value' })]);
  });

  it('keeps a "__proto__" object key as an own entry without prototype mutation', () => {
    const result = parseJsonValue('{ "__proto__": { polluted: true }, safe: 1 }');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value;
    expect(typeof value === 'object' && value !== null && !Array.isArray(value)).toBe(true);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(ownEntry(value, '__proto__')).toEqual({ polluted: true });
    expect(ownEntry(value, 'safe')).toBe(1);
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });

  it('rejects duplicate object keys', () => {
    const result = parseJsonValue('{ size: 1, size: 2 }');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual([
      expect.objectContaining({ message: 'Duplicate object key "size"' }),
    ]);
  });

  it('collects failures from invalid nested elements', () => {
    const result = parseJsonValue('[1, notJson, { bad: alsoNot }]');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toHaveLength(2);
  });

  it('leaves the quoted-object json() rule unchanged alongside it', () => {
    const { expr, ctx } = argOf('"{\\"weights\\": {\\"a\\": 1}}"');

    const result = json().parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ weights: { a: 1 } });
  });
});
