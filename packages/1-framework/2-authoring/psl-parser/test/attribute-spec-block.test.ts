import { describe, expect, it } from 'vitest';
import type { BlockInterpretCtx } from '../src/exports';
import { blockAttribute, interpretAttribute, leafDiagnostic, str } from '../src/exports';
import { Cursor, parseAttribute } from '../src/parse';
import { ModelAttributeAst } from '../src/syntax/ast/attributes';
import { createSyntaxTree } from '../src/syntax/red';

function blockAttr(source: string): { node: ModelAttributeAst; ctx: BlockInterpretCtx } {
  const cursor = new Cursor(source);
  const node = ModelAttributeAst.cast(createSyntaxTree(parseAttribute(cursor)));
  if (!node) throw new Error('expected a block attribute');
  return {
    node,
    ctx: { level: 'block', sourceId: 'schema.prisma', sourceFile: cursor.sourceFile },
  };
}

describe('blockAttribute', () => {
  it('builds a block-level spec', () => {
    const spec = blockAttribute('type', { positional: [{ key: 'codecId', type: str() }] });

    expect(spec).toMatchObject({ level: 'block', name: 'type', named: {} });
    expect(spec.positional.map((param) => param.key)).toEqual(['codecId']);
  });

  it('interprets a @@ attribute with a ctx that has no model', () => {
    const { node, ctx } = blockAttr('@@type("pg/text@1")');
    const spec = blockAttribute('type', { positional: [{ key: 'codecId', type: str() }] });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ codecId: 'pg/text@1' });
  });

  it('reports a missing argument anchored on the attribute', () => {
    const { node, ctx } = blockAttr('@@map()');
    const spec = blockAttribute('map', { positional: [{ key: 'name', type: str() }] });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Attribute "map" is missing required argument "name"',
        sourceId: 'schema.prisma',
      }),
    ]);
  });

  it('runs refine over the block ctx', () => {
    const { node, ctx } = blockAttr('@@map("")');
    const spec = blockAttribute('map', {
      positional: [{ key: 'name', type: str() }],
      refine: (parsed, refineCtx, attributeNode) =>
        parsed.name === ''
          ? [leafDiagnostic(refineCtx, attributeNode, 'empty name', 'PSL_MAP_EMPTY')]
          : [],
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual([
      expect.objectContaining({ code: 'PSL_MAP_EMPTY', message: 'empty name' }),
    ]);
  });
});
