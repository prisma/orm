import { notOk, ok, type Result } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { diagnosticSource, type PslDiagnostic } from '../src/diagnostic';
import type { ArgType, AttributeCtx, FieldAttributeCtx } from '../src/exports';
import {
  fieldAttribute,
  int,
  interpretArgs,
  interpretAttribute,
  nodePslSpan,
  optional,
} from '../src/exports';
import { Cursor, parse, parseAttribute } from '../src/parse';
import { PslSources } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';
import { FieldAttributeAst } from '../src/syntax/ast/attributes';
import { StringLiteralExprAst } from '../src/syntax/ast/expressions';
import { createSyntaxTree } from '../src/syntax/red';

function makeCtx(sources: PslSources): FieldAttributeCtx {
  const { document, sources: modelSources } = parse('model M {\n  id Int @id\n}\n', 'test.psl');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources: modelSources,
    pslBlockDescriptors: {},
  });
  const selfModel = symbolTable.topLevel.models['M'];
  if (!selfModel) throw new Error('expected model M in the symbol table');
  const field = selfModel.fields['id'];
  if (!field) throw new Error('expected field id on model M');
  return {
    sources,
    selfModel,
    field,
    resolveReferencedModel: () => undefined,
  };
}

function fieldAttr(source: string): { node: FieldAttributeAst; ctx: FieldAttributeCtx } {
  const cursor = new Cursor('schema.prisma', source);
  const root = createSyntaxTree(parseAttribute(cursor));
  const node = FieldAttributeAst.cast(root);
  if (!node) throw new Error('expected a field attribute');
  return { node, ctx: makeCtx(new PslSources([[root, cursor.sourceFile]])) };
}

function str(): ArgType<string, AttributeCtx> {
  return {
    kind: 'str',
    label: 'string',
    parse: (arg, ctx): Result<string, readonly PslDiagnostic[]> => {
      if (arg instanceof StringLiteralExprAst) {
        const value = arg.value();
        if (value !== undefined) return ok(value);
      }
      return notOk([
        {
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: 'expected a quoted string',
          ...diagnosticSource(ctx.sources, arg.syntax).at(nodePslSpan(arg.syntax, ctx.sources)),
        },
      ]);
    },
  };
}

const FAILING_DIAGNOSTIC: PslDiagnostic = {
  code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
  message: 'this leaf always fails',
  filename: 'schema.prisma',
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
};

function failing(): ArgType<never, AttributeCtx> {
  return {
    kind: 'rejecting',
    label: 'failing',
    parse: (): Result<never, readonly PslDiagnostic[]> => notOk([FAILING_DIAGNOSTIC]),
  };
}

describe('interpretAttribute positional binding', () => {
  it('binds a positional argument into its slot key', () => {
    const { node, ctx } = fieldAttr('@rel("Posts")');
    const spec = fieldAttribute('rel', {
      documentation: 'Declares a field attribute for argument binding.',
      positional: [
        { key: 'name', type: str(), documentation: 'The value bound to this positional slot.' },
      ],
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: 'Posts' });
  });

  it('rejects more positional arguments than declared slots', () => {
    const { node, ctx } = fieldAttr('@rel("a", "b")');
    const spec = fieldAttribute('rel', {
      documentation: 'Declares a field attribute for argument binding.',
      positional: [
        {
          key: 'name',
          type: optional(str()),
          documentation: 'The value bound to this positional slot.',
        },
      ],
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
      expect(result.failure[0]?.range).toEqual(
        ctx.sources
          .sourceFileFor(node.syntax)
          .pslSpanToRange(nodePslSpan(node.syntax, ctx.sources)),
      );
    }
  });
});

describe('interpretAttribute named binding', () => {
  it('binds named arguments by key', () => {
    const { node, ctx } = fieldAttr('@rel(name: "Posts", map: "fk")');
    const spec = fieldAttribute('rel', {
      documentation: 'Declares a field attribute for argument binding.',
      named: {
        name: { type: optional(str()), documentation: 'The relation name.' },
        map: { type: optional(str()), documentation: 'The mapped constraint name.' },
      },
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: 'Posts', map: 'fk' });
  });

  it('rejects an unknown named argument anchored to the argument span', () => {
    const { node, ctx } = fieldAttr('@rel(foo: "x")');
    const spec = fieldAttribute('rel', {
      documentation: 'Declares a field attribute for argument binding.',
      named: { name: { type: optional(str()), documentation: 'The value supplied by name.' } },
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
      expect(result.failure[0]?.message).toContain('foo');
      expect(result.failure[0]?.range).not.toEqual(
        ctx.sources
          .sourceFileFor(node.syntax)
          .pslSpanToRange(nodePslSpan(node.syntax, ctx.sources)),
      );
    }
  });
});

describe('interpretAttribute positional-or-named duplicate', () => {
  it('rejects a key supplied both positionally and by name even when the values agree, anchored to the duplicate', () => {
    const { node, ctx } = fieldAttr('@rel("Foo", name: "Foo")');
    const spec = fieldAttribute('rel', {
      documentation: 'Declares a field attribute for argument binding.',
      positional: [
        {
          key: 'name',
          type: optional(str()),
          documentation: 'The value bound to this positional slot.',
        },
      ],
      named: { name: { type: optional(str()), documentation: 'The value supplied by name.' } },
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
      expect(result.failure[0]?.range).not.toEqual(
        ctx.sources
          .sourceFileFor(node.syntax)
          .pslSpanToRange(nodePslSpan(node.syntax, ctx.sources)),
      );
    }
  });

  it('rejects a key supplied both positionally and by name when the values disagree, anchored to the duplicate', () => {
    const { node, ctx } = fieldAttr('@rel("A", name: "B")');
    const spec = fieldAttribute('rel', {
      documentation: 'Declares a field attribute for argument binding.',
      positional: [
        {
          key: 'name',
          type: optional(str()),
          documentation: 'The value bound to this positional slot.',
        },
      ],
      named: { name: { type: optional(str()), documentation: 'The value supplied by name.' } },
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
      expect(result.failure[0]?.range).not.toEqual(
        ctx.sources
          .sourceFileFor(node.syntax)
          .pslSpanToRange(nodePslSpan(node.syntax, ctx.sources)),
      );
    }
  });
});

describe('interpretAttribute duplicate named arguments', () => {
  it('rejects a named key supplied twice with differing values, anchored to the duplicate', () => {
    const { node, ctx } = fieldAttr('@rel(name: "A", name: "B")');
    const spec = fieldAttribute('rel', {
      documentation: 'Declares a field attribute for argument binding.',
      named: { name: { type: optional(str()), documentation: 'The value supplied by name.' } },
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
      expect(result.failure[0]?.range).not.toEqual(
        ctx.sources
          .sourceFileFor(node.syntax)
          .pslSpanToRange(nodePslSpan(node.syntax, ctx.sources)),
      );
    }
  });

  it('rejects a named key supplied twice even when the values are equal', () => {
    const { node, ctx } = fieldAttr('@rel(name: "A", name: "A")');
    const spec = fieldAttribute('rel', {
      documentation: 'Declares a field attribute for argument binding.',
      named: { name: { type: optional(str()), documentation: 'The value supplied by name.' } },
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });
});

describe('interpretAttribute optional and default application', () => {
  it('applies a default for an absent optional argument', () => {
    const { node, ctx } = fieldAttr('@rel()');
    const spec = fieldAttribute('rel', {
      documentation: 'Declares a field attribute for argument binding.',
      named: {
        map: { type: optional(str(), 'default_fk'), documentation: 'The value supplied by name.' },
      },
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ map: 'default_fk' });
  });

  it('omits an absent optional argument with no default', () => {
    const { node, ctx } = fieldAttr('@rel()');
    const spec = fieldAttribute('rel', {
      documentation: 'Declares a field attribute for argument binding.',
      named: { name: { type: optional(str()), documentation: 'The value supplied by name.' } },
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
  });

  it('overrides a default when the argument is present', () => {
    const { node, ctx } = fieldAttr('@rel(map: "explicit")');
    const spec = fieldAttribute('rel', {
      documentation: 'Declares a field attribute for argument binding.',
      named: {
        map: { type: optional(str(), 'default_fk'), documentation: 'The value supplied by name.' },
      },
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ map: 'explicit' });
  });

  it('reports a missing required argument', () => {
    const { node, ctx } = fieldAttr('@rel()');
    const spec = fieldAttribute('rel', {
      documentation: 'Declares a field attribute for argument binding.',
      named: { name: { type: str(), documentation: 'The value supplied by name.' } },
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });
});

describe('interpretAttribute refine', () => {
  it('runs refine on the parsed output and surfaces its diagnostics', () => {
    const { node, ctx } = fieldAttr('@rel(name: "bad")');
    const seen: string[] = [];
    const spec = fieldAttribute('rel', {
      documentation: 'Declares a field attribute for argument binding.',
      named: { name: { type: optional(str()), documentation: 'The value supplied by name.' } },
      refine: (parsed, refineCtx): readonly PslDiagnostic[] => {
        if (parsed.name !== undefined) seen.push(parsed.name);
        return [
          {
            code: 'PSL_INVALID_RELATION_ATTRIBUTE',
            message: 'refine rejected the value',
            ...diagnosticSource(refineCtx.sources, node.syntax).at(
              nodePslSpan(node.syntax, refineCtx.sources),
            ),
          },
        ];
      },
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(seen).toEqual(['bad']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.message).toBe('refine rejected the value');
    }
  });

  it('returns ok when refine reports no diagnostics', () => {
    const { node, ctx } = fieldAttr('@rel(name: "ok")');
    const spec = fieldAttribute('rel', {
      documentation: 'Declares a field attribute for argument binding.',
      named: { name: { type: optional(str()), documentation: 'The value supplied by name.' } },
      refine: (): readonly PslDiagnostic[] => [],
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: 'ok' });
  });

  it('does not run refine when an argument fails to parse', () => {
    const { node, ctx } = fieldAttr('@rel(name: "x")');
    let refined = false;
    const spec = fieldAttribute('rel', {
      documentation: 'Declares a field attribute for argument binding.',
      named: { name: { type: failing(), documentation: 'The value supplied by name.' } },
      refine: (): readonly PslDiagnostic[] => {
        refined = true;
        return [];
      },
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(refined).toBe(false);
    expect(result.ok).toBe(false);
  });
});

describe('interpretAttribute leaf purity', () => {
  it('threads a failing leaf diagnostic through the Result rather than a sink', () => {
    const { node, ctx } = fieldAttr('@rel(name: "x")');
    const spec = fieldAttribute('rel', {
      documentation: 'Declares a field attribute for argument binding.',
      named: { name: { type: failing(), documentation: 'The value supplied by name.' } },
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toEqual([FAILING_DIAGNOSTIC]);
    }
  });
});

describe('interpretArgs', () => {
  it('binds arguments into a plain record from an argument iterable', () => {
    const { node, ctx } = fieldAttr('@rel(size: 16)');
    const span = nodePslSpan(node.syntax, ctx.sources);

    const result = interpretArgs(
      node.argList()?.args() ?? [],
      {
        name: 'rel',
        positional: [],
        named: { size: { type: int(), documentation: 'The value supplied by name.' } },
      },
      ctx,
      span,
      node.syntax,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ size: 16 });
  });

  it('anchors a missing-required diagnostic to the provided span', () => {
    const { node, ctx } = fieldAttr('@rel()');
    const span = nodePslSpan(node.syntax, ctx.sources);

    const result = interpretArgs(
      node.argList()?.args() ?? [],
      {
        name: 'rel',
        positional: [],
        named: { size: { type: int(), documentation: 'The value supplied by name.' } },
      },
      ctx,
      span,
      node.syntax,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.message).toBe(
        'Attribute "rel" is missing required argument "size"',
      );
      expect(result.failure[0]?.range).toEqual(
        ctx.sources.sourceFileFor(node.syntax).pslSpanToRange(span),
      );
    }
  });
});
