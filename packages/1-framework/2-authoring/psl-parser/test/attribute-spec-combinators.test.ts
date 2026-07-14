import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import type { ArgType, InterpretCtx } from '../src/exports';
import {
  bool,
  entityRef,
  fieldAttribute,
  fieldRef,
  funcCall,
  identifier,
  int,
  interpretAttribute,
  json,
  list,
  modelAttribute,
  nodePslSpan,
  num,
  oneOf,
  optional,
  record,
  str,
} from '../src/exports';
import { Cursor, parse, parseAttribute } from '../src/parse';
import type { SourceFile } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';
import { FieldAttributeAst, ModelAttributeAst } from '../src/syntax/ast/attributes';
import type { ExpressionAst } from '../src/syntax/ast/expressions';
import { createSyntaxTree } from '../src/syntax/red';

function makeCtx(sourceFile: SourceFile): InterpretCtx {
  const { document, sourceFile: modelSource } = parse('model M {\n  id Int @id\n}\n');
  const { table } = buildSymbolTable({
    document,
    sourceFile: modelSource,
    pslBlockDescriptors: {},
  });
  const selfModel = table.topLevel.models['M'];
  if (!selfModel) throw new Error('expected model M in the symbol table');
  return {
    level: 'field',
    sourceId: 'schema.prisma',
    sourceFile,
    selfModel,
    resolveReferencedModel: () => undefined,
  };
}

function argOf(exprSource: string): { expr: ExpressionAst; ctx: InterpretCtx } {
  const cursor = new Cursor(`@x(${exprSource})`);
  const node = FieldAttributeAst.cast(createSyntaxTree(parseAttribute(cursor)));
  if (!node) throw new Error('expected a field attribute');
  const first = [...(node.argList()?.args() ?? [])][0];
  const expr = first?.value();
  if (!expr) throw new Error('expected an argument expression');
  return { expr, ctx: makeCtx(cursor.sourceFile) };
}

function modelAttrOf(source: string): { node: ModelAttributeAst; ctx: InterpretCtx } {
  const cursor = new Cursor(source);
  const node = ModelAttributeAst.cast(createSyntaxTree(parseAttribute(cursor)));
  if (!node) throw new Error('expected a model attribute');
  return { node, ctx: { ...makeCtx(cursor.sourceFile), level: 'model' } };
}

describe('str', () => {
  it('parses a quoted string into its value', () => {
    const { expr, ctx } = argOf('"Posts"');

    const result = str().parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('Posts');
  });

  it('rejects a non-string token with the threaded code', () => {
    const { expr, ctx } = argOf('42');

    const result = str().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });

  it('matches only the pinned string literal', () => {
    const { expr, ctx } = argOf('"hashed"');

    const result = str('hashed').parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('hashed');
  });

  it('rejects a string literal other than the pinned value', () => {
    const { expr, ctx } = argOf('"2dsphere"');

    const result = str('hashed').parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });

  it('rejects a bare identifier carrying the pinned characters', () => {
    const { expr, ctx } = argOf('hashed');

    const result = str('hashed').parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('rejects a number literal against the pinned value', () => {
    const { expr, ctx } = argOf('2');

    const result = str('hashed').parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });
});

describe('identifier', () => {
  it('matches a bare identifier equal to the pinned name', () => {
    const { expr, ctx } = argOf('Cascade');

    const result = identifier('Cascade').parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('Cascade');
  });

  it('rejects a bare identifier with a different name', () => {
    const { expr, ctx } = argOf('Cascade');

    const result = identifier('NoAction').parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });

  it('rejects a quoted string with the same characters', () => {
    const { expr, ctx } = argOf('"Cascade"');

    const result = identifier('Cascade').parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('rejects a number token', () => {
    const { expr, ctx } = argOf('1');

    const result = identifier('Cascade').parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });
});

describe('int', () => {
  it('parses an integer literal into its number value', () => {
    const { expr, ctx } = argOf('42');

    const result = int().parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it('rejects a non-integer number with the threaded code', () => {
    const { expr, ctx } = argOf('1.5');

    const result = int().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });

  it('rejects a non-number token', () => {
    const { expr, ctx } = argOf('"42"');

    const result = int().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('accepts an integer within the declared bounds', () => {
    const { expr, ctx } = argOf('16');

    const result = int({ min: 2, max: 255 }).parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(16);
  });

  it('rejects an integer below the minimum with a range message', () => {
    const { expr, ctx } = argOf('1');

    const result = int({ min: 2, max: 255 }).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.message).toBe('Expected an integer between 2 and 255');
    }
  });

  it('rejects an integer above the maximum with a range message', () => {
    const { expr, ctx } = argOf('300');

    const result = int({ min: 2, max: 255 }).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.message).toBe('Expected an integer between 2 and 255');
    }
  });

  it('still rejects a non-integer even within the bounds', () => {
    const { expr, ctx } = argOf('1.5');

    const result = int({ min: 0, max: 5 }).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure[0]?.message).toBe('Expected an integer literal');
  });
});

describe('num', () => {
  it('parses an integer literal into its number value', () => {
    const { expr, ctx } = argOf('5');

    const result = num().parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(5);
  });

  it('parses a fractional literal into its number value', () => {
    const { expr, ctx } = argOf('1.5');

    const result = num().parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1.5);
  });

  it('rejects a string literal with the threaded code', () => {
    const { expr, ctx } = argOf('"5"');

    const result = num().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });

  it('rejects a boolean literal', () => {
    const { expr, ctx } = argOf('true');

    const result = num().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('rejects a bare identifier', () => {
    const { expr, ctx } = argOf('Cascade');

    const result = num().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('matches only the pinned number literal', () => {
    const { expr, ctx } = argOf('4');

    const result = num(4).parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(4);
  });

  it('rejects a number literal other than the pinned value', () => {
    const { expr, ctx } = argOf('7');

    const result = num(4).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });

  it('rejects a string literal carrying the pinned digits', () => {
    const { expr, ctx } = argOf('"4"');

    const result = num(4).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });
});

describe('json', () => {
  it('parses a quoted JSON object string into a record', () => {
    const { expr, ctx } = argOf('"{\\"a\\": 1}"');

    const result = json().parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it('rejects a JSON array string', () => {
    const { expr, ctx } = argOf('"[1,2]"');

    const result = json().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });

  it('rejects a JSON scalar string', () => {
    const { expr, ctx } = argOf('"5"');

    const result = json().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('rejects an invalid-JSON string', () => {
    const { expr, ctx } = argOf('"{not json}"');

    const result = json().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('rejects a bare identifier', () => {
    const { expr, ctx } = argOf('Cascade');

    const result = json().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });

  it('rejects a number literal', () => {
    const { expr, ctx } = argOf('5');

    const result = json().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });
});

describe('bool', () => {
  it('parses true into its boolean value', () => {
    const { expr, ctx } = argOf('true');

    const result = bool().parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(true);
  });

  it('parses false into its boolean value', () => {
    const { expr, ctx } = argOf('false');

    const result = bool().parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(false);
  });

  it('rejects a non-boolean token with the threaded code', () => {
    const { expr, ctx } = argOf('"true"');

    const result = bool().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });
});

describe('modelAttribute', () => {
  it('fixes the spec level to model', () => {
    const spec = modelAttribute('demo', { positional: [{ key: 'k', type: int() }] });

    expect(spec.level).toBe('model');
    expect(spec.name).toBe('demo');
  });

  it('binds a model-attribute node through interpretAttribute', () => {
    const { node, ctx } = modelAttrOf('@@demo(7)');
    const spec = modelAttribute('demo', { positional: [{ key: 'k', type: int() }] });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ k: 7 });
  });

  it('surfaces a leaf diagnostic when a model-attribute argument fails to parse', () => {
    const { node, ctx } = modelAttrOf('@@demo("nope")');
    const spec = modelAttribute('demo', { positional: [{ key: 'k', type: int() }] });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });
});

describe('oneOf', () => {
  it('returns the first alternative that succeeds', () => {
    const { expr, ctx } = argOf('Cascade');
    const first: ArgType<'first'> = { kind: 'const', label: 'first', parse: () => ok('first') };
    const second: ArgType<'second'> = { kind: 'const', label: 'second', parse: () => ok('second') };

    const result = oneOf(first, second).parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('first');
  });

  it('matches whichever alternative accepts the argument', () => {
    const { expr, ctx } = argOf('SetNull');

    const result = oneOf(identifier('Cascade'), identifier('SetNull')).parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('SetNull');
  });

  it('emits a single aggregate diagnostic anchored to the arg node when every alternative fails', () => {
    const { expr, ctx } = argOf('WeirdAction');

    const result = oneOf(identifier('Cascade'), identifier('SetNull')).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
      expect(result.failure[0]?.span).toEqual(nodePslSpan(expr.syntax, ctx.sourceFile));
      expect(result.failure[0]?.message).toContain('Cascade');
      expect(result.failure[0]?.message).toContain('SetNull');
    }
  });
});

describe('fieldRef', () => {
  it('resolves a field that exists on the self model', () => {
    const { expr, ctx } = argOf('id');

    const result = fieldRef('self').parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('id');
  });

  it('emits an existence diagnostic for a field missing from the self model', () => {
    const { expr, ctx } = argOf('ghostField');

    const result = fieldRef('self').parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });

  it('resolves a field against the referenced model when it is in scope', () => {
    const { expr, ctx } = argOf('id');
    const referencedCtx: InterpretCtx = { ...ctx, resolveReferencedModel: () => ctx.selfModel };

    const result = fieldRef('referenced').parse(expr, referencedCtx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('id');
  });

  it('carries a referenced name through when the referenced model is out of scope', () => {
    const { expr, ctx } = argOf('ghostField');

    const result = fieldRef('referenced').parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('ghostField');
  });

  it('carries the scope as combinator metadata', () => {
    expect(fieldRef('self').scope).toBe('self');
    expect(fieldRef('referenced').scope).toBe('referenced');
  });

  it('rejects a non-identifier token', () => {
    const { expr, ctx } = argOf('"title"');

    const result = fieldRef('self').parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
  });
});

describe('entityRef', () => {
  it('parses a bare identifier into its model name', () => {
    const { expr, ctx } = argOf('Task');

    const result = entityRef().parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('Task');
  });

  it('rejects a quoted string literal', () => {
    const { expr, ctx } = argOf('"Task"');

    const result = entityRef().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });

  it('rejects a number token', () => {
    const { expr, ctx } = argOf('42');

    const result = entityRef().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('rejects an array literal', () => {
    const { expr, ctx } = argOf('[Task]');

    const result = entityRef().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });
});

describe('list', () => {
  it('maps each element through the element combinator', () => {
    const { expr, ctx } = argOf('["a", "b"]');

    const result = list(str()).parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(['a', 'b']);
  });

  it('rejects an empty list when nonEmpty is set', () => {
    const { expr, ctx } = argOf('[]');

    const result = list(str(), { nonEmpty: true }).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('accepts a populated list when nonEmpty is set', () => {
    const { expr, ctx } = argOf('["a", "b"]');

    const result = list(str(), { nonEmpty: true }).parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(['a', 'b']);
  });

  it('rejects duplicates when unique is set, anchored per offending element', () => {
    const { expr, ctx } = argOf('["a", "a"]');

    const result = list(str(), { unique: true }).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('propagates an element parse error', () => {
    const { expr, ctx } = argOf('["a", 1]');

    const result = list(str()).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
  });

  it('rejects a non-array argument', () => {
    const { expr, ctx } = argOf('"a"');

    const result = list(str()).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });
});

describe('record', () => {
  it('parses a single-key object into a record', () => {
    const { expr, ctx } = argOf('{ where: "active = true" }');

    const result = record(str()).parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ where: 'active = true' });
  });

  it('parses a multi-key object into a record', () => {
    const { expr, ctx } = argOf('{ ops: "gin_trgm_ops", where: "deleted = false" }');

    const result = record(str()).parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ ops: 'gin_trgm_ops', where: 'deleted = false' });
  });

  it('parses an empty object into an empty record', () => {
    const { expr, ctx } = argOf('{}');

    const result = record(str()).parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
  });

  it('rejects a duplicate key', () => {
    const { expr, ctx } = argOf('{ ops: "a", ops: "b" }');

    const result = record(str()).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });

  it('rejects a non-object argument', () => {
    const { expr, ctx } = argOf('"nope"');

    const result = record(str()).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });

  it('propagates a leaf parse error when a value does not match', () => {
    const { expr, ctx } = argOf('{ ops: 1 }');

    const result = record(str()).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
  });
});

describe('funcCall', () => {
  it('accepts a nullary call whose callee matches the pinned name', () => {
    const { expr, ctx } = argOf('now()');

    const result = funcCall('now', {}).parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ fn: 'now', args: {} });
  });

  it('rejects a call whose callee differs from the pinned name', () => {
    const { expr, ctx } = argOf('uuid()');

    const result = funcCall('now', {}).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });

  it('rejects a bare identifier', () => {
    const { expr, ctx } = argOf('now');

    const result = funcCall('now', {}).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });

  it('rejects a string literal', () => {
    const { expr, ctx } = argOf('"now"');

    const result = funcCall('now', {}).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('rejects an array literal', () => {
    const { expr, ctx } = argOf('[1]');

    const result = funcCall('now', {}).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('rejects a namespaced callee', () => {
    const { expr, ctx } = argOf('foo.now()');

    const result = funcCall('now', {}).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });
});

describe('funcCall with a signature', () => {
  const nanoid = () =>
    funcCall('nanoid', {
      positional: [{ key: 'size', type: optional(int({ min: 2, max: 255 })) }],
    });

  it('binds a positional argument through the signature into the typed record', () => {
    const { expr, ctx } = argOf('nanoid(16)');

    const result = nanoid().parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ fn: 'nanoid', args: { size: 16 } });
  });

  it('omits an absent optional argument, keeping the fn discriminant', () => {
    const { expr, ctx } = argOf('nanoid()');

    const result = nanoid().parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ fn: 'nanoid', args: {} });
  });

  it('rejects an out-of-range argument', () => {
    const { expr, ctx } = argOf('nanoid(1)');

    const result = nanoid().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('rejects excess positional arguments', () => {
    const { expr, ctx } = argOf('nanoid(16, 2)');

    const result = nanoid().parse(expr, ctx);

    expect(result.ok).toBe(false);
  });

  it('still rejects a callee that differs from the pinned name', () => {
    const { expr, ctx } = argOf('cuid(16)');

    const result = nanoid().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });
});

describe('combinator code through interpretAttribute', () => {
  it('emits a leaf diagnostic carrying the unified attribute code', () => {
    const cursor = new Cursor('@rel(1)');
    const node = FieldAttributeAst.cast(createSyntaxTree(parseAttribute(cursor)));
    if (!node) throw new Error('expected a field attribute');
    const ctx = makeCtx(cursor.sourceFile);
    const spec = fieldAttribute('rel', {
      positional: [{ key: 'name', type: str() }],
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });
});
