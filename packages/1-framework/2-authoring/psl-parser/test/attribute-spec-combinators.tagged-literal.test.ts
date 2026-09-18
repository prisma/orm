import { describe, expect, it } from 'vitest';
import type { FieldAttributeCtx } from '../src/exports';
import { taggedLiteral } from '../src/exports';
import { Cursor, parse, parseAttribute } from '../src/parse';
import type { SourceFile } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';
import { FieldAttributeAst } from '../src/syntax/ast/attributes';
import type { ExpressionAst } from '../src/syntax/ast/expressions';
import { createSyntaxTree } from '../src/syntax/red';

function makeCtx(sourceFile: SourceFile): FieldAttributeCtx {
  const { document, sourceFile: modelSource } = parse('model M {\n  id Int @id\n}\n');
  const { table } = buildSymbolTable({
    document,
    sourceFile: modelSource,
    pslBlockDescriptors: {},
  });
  const selfModel = table.topLevel.models['M'];
  if (!selfModel) throw new Error('expected model M in the symbol table');
  const field = selfModel.fields['id'];
  if (!field) throw new Error('expected field id on model M');
  return {
    sourceId: 'schema.prisma',
    sourceFile,
    selfModel,
    field,
    resolveReferencedModel: () => undefined,
  };
}

function argOf(exprSource: string): { expr: ExpressionAst; ctx: FieldAttributeCtx } {
  const cursor = new Cursor(`@x(${exprSource})`);
  const node = FieldAttributeAst.cast(createSyntaxTree(parseAttribute(cursor)));
  if (!node) throw new Error('expected a field attribute');
  const first = [...(node.argList()?.args() ?? [])][0];
  const expr = first?.value();
  if (!expr) throw new Error('expected an argument expression');
  return { expr, ctx: makeCtx(cursor.sourceFile) };
}

describe('taggedLiteral', () => {
  const type = taggedLiteral(['sql', 'pg.sql'], { documentation: 'Raw SQL, used verbatim.' });

  it('labels itself with the first tag', () => {
    expect(type.kind).toBe('taggedLiteral');
    expect(type.label).toBe('sql`...`');
    expect(type.tags).toEqual(['sql', 'pg.sql']);
    expect(type.documentation).toBe('Raw SQL, used verbatim.');
  });

  it('returns the tag, the canonicalized body, and the span of the whole literal', () => {
    const { expr, ctx } = argOf('pg.sql`\n  now()\n`');
    const result = type.parse(expr, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        tag: 'pg.sql',
        canonicalization: { ok: true, body: 'now()' },
        span: { start: { offset: 3, line: 1, column: 4 }, end: { offset: 20, line: 3, column: 2 } },
      });
    }
  });

  it('accepts a double-quoted string', () => {
    const { expr, ctx } = argOf('sql"now()"');
    expect(type.parse(expr, ctx)).toMatchObject({
      ok: true,
      value: { tag: 'sql', canonicalization: { ok: true, body: 'now()' } },
    });
  });

  it('accepts a tag it does not list, leaving the tag check to lowering', () => {
    const { expr, ctx } = argOf('sqlite.sql`x`');
    expect(type.parse(expr, ctx)).toMatchObject({
      ok: true,
      value: { tag: 'sqlite.sql', canonicalization: { ok: true, body: 'x' } },
    });
  });

  it('rejects an argument that is not a tagged literal with the generic code', () => {
    for (const source of ['"sql"', 'sql', 'sql()', '42']) {
      const { expr, ctx } = argOf(source);
      const result = type.parse(expr, ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure).toHaveLength(1);
        expect(result.failure[0]).toMatchObject({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: 'Expected a tagged literal',
        });
      }
    }
  });

  it('passes a body containing a dollar-brace sequence through verbatim', () => {
    const { expr, ctx } = argOf('sql`a $' + '{x} b`');
    expect(type.parse(expr, ctx)).toMatchObject({
      ok: true,
      value: { canonicalization: { ok: true, body: 'a $' + '{x} b' } },
    });
  });

  it('returns a failed canonicalization for lowering to report', () => {
    const nul = argOf('sql`a\0b`');
    expect(type.parse(nul.expr, nul.ctx)).toMatchObject({
      ok: true,
      value: { canonicalization: { ok: false, reason: 'nul', offset: 1 } },
    });
    const large = argOf(`sql\`${'a'.repeat(65537)}\``);
    expect(type.parse(large.expr, large.ctx)).toMatchObject({
      ok: true,
      value: { canonicalization: { ok: false, reason: 'too-large' } },
    });
  });
});
