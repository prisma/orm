import { describe, expect, it } from 'vitest';
import type { AttributeCtx } from '../src/exports';
import { blockAttribute, interpretAttribute, leafDiagnostic, str } from '../src/exports';
import { Cursor, parseAttribute } from '../src/parse';
import { PslSources } from '../src/source-file';
import { ModelAttributeAst } from '../src/syntax/ast/attributes';
import { createSyntaxTree } from '../src/syntax/red';

function blockAttr(source: string): { node: ModelAttributeAst; ctx: AttributeCtx } {
  const cursor = new Cursor('schema.prisma', source);
  const root = createSyntaxTree(parseAttribute(cursor));
  const node = ModelAttributeAst.cast(root);
  if (!node) throw new Error('expected a block attribute');
  return {
    node,
    ctx: { sources: new PslSources([[root, cursor.sourceFile]]) },
  };
}

describe('blockAttribute', () => {
  it('builds a block-level spec', () => {
    const spec = blockAttribute('type', {
      documentation: 'Declares a block attribute for argument binding.',
      positional: [
        { key: 'codecId', type: str(), documentation: 'The value bound to this positional slot.' },
      ],
    });

    expect(spec).toMatchObject({ level: 'block', name: 'type', named: {} });
    expect(spec.positional.map((param) => param.key)).toEqual(['codecId']);
  });

  it('interprets a @@ attribute with a ctx that has no model', () => {
    const { node, ctx } = blockAttr('@@type("pg/text@1")');
    const spec = blockAttribute('type', {
      documentation: 'Declares a block attribute for argument binding.',
      positional: [
        { key: 'codecId', type: str(), documentation: 'The value bound to this positional slot.' },
      ],
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ codecId: 'pg/text@1' });
  });

  it('reports a missing argument anchored on the attribute', () => {
    const { node, ctx } = blockAttr('@@map()');
    const spec = blockAttribute('map', {
      documentation: 'Declares a block attribute for argument binding.',
      positional: [
        { key: 'name', type: str(), documentation: 'The value bound to this positional slot.' },
      ],
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Attribute "map" is missing required argument "name"',
        filename: 'schema.prisma',
      }),
    ]);
  });

  it('runs refine over the block ctx', () => {
    const { node, ctx } = blockAttr('@@map("")');
    const spec = blockAttribute('map', {
      documentation: 'Declares a block attribute for argument binding.',
      positional: [
        { key: 'name', type: str(), documentation: 'The value bound to this positional slot.' },
      ],
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
