import type { JsonValue } from '@internal/contract/types';
import type {
  DataTypeAuthoringEntry,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import {
  createDataTypeLookup,
  type DataTypeId,
  dataType,
  dataTypeId,
} from '@internal/framework-components/codec';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import type { AttributeCtx } from '../src/attribute-spec/types';
import { dataTypeValue, funcCall, oneOf, str } from '../src/exports';
import { Cursor, parseAttribute } from '../src/parse';
import { PslSources } from '../src/source-file';
import { FieldAttributeAst } from '../src/syntax/ast/attributes';
import { type ExpressionAst, NumberLiteralExprAst } from '../src/syntax/ast/expressions';
import { type GreenElement, greenNode, greenToken } from '../src/syntax/green';
import { createSyntaxTree } from '../src/syntax/red';
import { supportBinder } from './support';

const unchanged = (value: JsonValue) => value;

const sqlExpression = dataType('sql/expression', {});
const pgText = dataType('pg/text', {});
const pgBool = dataType('pg/bool', {});
const pgInt2 = dataType('pg/int2', {});
const pgInt4 = dataType('pg/int4', { casts: { [pgInt2.id]: (value) => String(value) } });
const pgNumeric = dataType('pg/numeric', {});
const pgJson = dataType('pg/json', {});
const pgUuid = dataType('pg/uuid', {
  casts: {
    [pgText.id]: (value) => {
      if (typeof value === 'string' && value.length === 36) return value;
      throw new Error(`"${String(value)}" is not a UUID.`);
    },
  },
});

const entries: Readonly<Record<string, DataTypeAuthoringEntry>> = {
  [sqlExpression.id]: {
    written: { kind: 'tag', tag: 'sql', parse: (text) => text },
    print: (value) => String(value),
    documentation: 'A SQL expression in the language of the target database.',
  },
  [pgText.id]: {
    written: { kind: 'plain', syntax: 'string', parse: (text) => text },
    print: (value) => String(value),
    documentation: 'Text.',
  },
  [pgBool.id]: {
    written: {
      kind: 'plain',
      syntax: 'boolean',
      parse: (text) => text === 'true',
    },
    print: (value) => String(value),
    documentation: 'A boolean, written true or false.',
  },
  [pgNumeric.id]: {
    written: {
      kind: 'plain',
      syntax: 'number',
      types: [pgInt2.id, pgInt4.id, pgNumeric.id],
      classify: (text) => {
        if (!/^-?\d+$/.test(text)) return { type: pgNumeric.id, value: text };
        const value = Number(text);
        return { type: Math.abs(value) < 32768 ? pgInt2.id : pgInt4.id, value };
      },
    },
    print: (value) => String(value),
    documentation: 'A number.',
  },
  [pgJson.id]: {
    written: { kind: 'tag', tag: 'json', parse: (text) => JSON.parse(text) },
    print: (value) => JSON.stringify(value),
    documentation: 'A JSON document.',
  },
};

const support: DataTypeSupport = {
  entries,
  lookup: createDataTypeLookup([
    sqlExpression,
    pgText,
    pgBool,
    pgInt2,
    pgInt4,
    pgNumeric,
    pgJson,
    pgUuid,
  ]),
};

function argOf(source: string): { expr: ExpressionAst; ctx: AttributeCtx } {
  const cursor = new Cursor('schema.prisma', `@x(${source})`);
  const root = createSyntaxTree(parseAttribute(cursor));
  const expr = [...(FieldAttributeAst.cast(root)?.argList()?.args() ?? [])][0]?.value();
  if (expr === undefined) throw new Error('expected an argument expression');
  const sources = new PslSources([[root, cursor.sourceFile]]);
  const symbols = {
    topLevel: {
      namespaces: {},
      models: {},
      compositeTypes: {},
      namedTypes: {},
      blocks: {},
      mixins: {},
    },
  };
  return {
    expr,
    ctx: { sources, symbols, binder: supportBinder({ sources, symbolTable: symbols }) },
  };
}

/**
 * An argument whose callee is colon-qualified. Source text cannot place one there, because `a:` opens a named argument, so the tree of the dotted form gets a colon in place of its dot.
 */
function colonQualifiedArgOf(source: string): { expr: ExpressionAst; ctx: AttributeCtx } {
  const dotted = parseAttribute(new Cursor('schema.prisma', `@x(${source.replace(':', '.')})`));
  const withColon = (element: GreenElement): GreenElement =>
    element.type === 'token'
      ? element.kind === 'Dot'
        ? greenToken('Colon', ':')
        : element
      : greenNode(element.kind, element.children.map(withColon));
  const green = withColon(dotted);
  if (green.type === 'token') throw new Error('expected an attribute node');
  const root = createSyntaxTree(green);
  const expr = [...(FieldAttributeAst.cast(root)?.argList()?.args() ?? [])][0]?.value();
  if (expr === undefined) throw new Error('expected an argument expression');
  const sources = new PslSources([[root, new Cursor('schema.prisma', `@x(${source})`).sourceFile]]);
  const symbols = {
    topLevel: {
      namespaces: {},
      models: {},
      compositeTypes: {},
      namedTypes: {},
      blocks: {},
      mixins: {},
    },
  };
  return {
    expr,
    ctx: { sources, symbols, binder: supportBinder({ sources, symbolTable: symbols }) },
  };
}

function parse(type: DataTypeId, source: string, over: DataTypeSupport = support) {
  const { expr, ctx } = argOf(source);
  return dataTypeValue(type, over).parse(expr, ctx);
}

/** The diagnostic for the argument `source`, which starts after `@x(` on the first line. */
function refusal(source: string, code: string, message: string) {
  return notOk([
    {
      code,
      message,
      filename: 'schema.prisma',
      range: {
        start: { line: 0, character: 3 },
        end: { line: 0, character: 3 + source.length },
      },
    },
  ]);
}

describe('dataTypeValue', () => {
  it('describes a type with a tag by its tag and entry documentation', () => {
    const type = dataTypeValue(sqlExpression.id, support);
    expect({
      kind: type.kind,
      label: type.label,
      dataType: type.dataType,
      tags: type.tags,
      documentation: type.documentation,
    }).toEqual({
      kind: 'dataTypeValue',
      label: 'sql`...`',
      dataType: 'sql/expression',
      tags: ['sql'],
      documentation: 'A SQL expression in the language of the target database.',
    });
  });

  it('describes a type without a tag by the forms it admits', () => {
    const type = dataTypeValue(pgInt4.id, support);
    expect({
      kind: type.kind,
      label: type.label,
      dataType: type.dataType,
      tags: type.tags,
      documentation: type.documentation,
    }).toEqual({
      kind: 'dataTypeValue',
      label: 'a number',
      dataType: 'pg/int4',
      tags: [],
      documentation: '',
    });
    expect(dataTypeValue(pgBool.id, support).label).toBe('true or false');
  });

  it('labels a type by its own tag before the tags of its cast sources', () => {
    const geo = dataType('pg/geo', { casts: { [pgJson.id]: unchanged } });
    const withGeo: DataTypeSupport = {
      entries: {
        ...entries,
        [geo.id]: {
          written: { kind: 'tag', tag: 'geo', parse: (text) => text },
          print: (value) => String(value),
          documentation: 'A geometry.',
        },
      },
      lookup: createDataTypeLookup([pgJson, geo]),
    };
    const type = dataTypeValue(geo.id, withGeo);
    expect({ label: type.label, tags: type.tags }).toEqual({
      label: 'geo`...`',
      tags: ['geo', 'json'],
    });
  });

  it('returns the canonical value, its type and the span of the argument', () => {
    expect(parse(sqlExpression.id, 'sql`\n  now()\n`')).toEqual(
      ok({
        type: 'sql/expression',
        value: 'now()',
        span: { start: { offset: 3, line: 1, column: 4 }, end: { offset: 17, line: 3, column: 2 } },
      }),
    );
  });

  it('takes a value of a type the receiving type casts from, returning the cast value', () => {
    expect(parse(pgInt4.id, '8')).toEqual(
      ok({
        type: 'pg/int4',
        value: '8',
        span: { start: { offset: 3, line: 1, column: 4 }, end: { offset: 4, line: 1, column: 5 } },
      }),
    );
  });

  it.each([
    ['an identifier', 'archived'],
    ['a function call', 'now()'],
    ['a list', '[1, 2]'],
    ['an object', '{ a: 1 }'],
  ])('refuses %s as invalid syntax', (found, source) => {
    expect(parse(sqlExpression.id, source)).toEqual(
      refusal(source, 'PSL_INVALID_ATTRIBUTE_SYNTAX', `Expected sql\`...\`; got ${found}`),
    );
  });

  it('refuses an expression that is not a literal', () => {
    const { ctx } = argOf('1');
    const root = createSyntaxTree(greenNode('NumberLiteralExpr', []));
    const sources = new PslSources([[root, new Cursor('schema.prisma', '').sourceFile]]);
    expect(
      dataTypeValue(sqlExpression.id, support).parse(new NumberLiteralExprAst(root), {
        ...ctx,
        sources,
      }),
    ).toEqual(
      notOk([
        {
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: 'Expected sql`...`; got an expression',
          filename: 'schema.prisma',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        },
      ]),
    );
  });

  it('refuses a tagged literal holding a NUL character', () => {
    const source = 'sql`a\0b`';
    expect(parse(sqlExpression.id, source)).toEqual(
      refusal(source, 'PSL_TAGGED_LITERAL_NUL', 'Tagged literals must not contain NUL characters.'),
    );
  });

  it('refuses a tagged literal larger than the limit', () => {
    const source = `sql\`${'a'.repeat(65537)}\``;
    expect(parse(sqlExpression.id, source)).toEqual(
      refusal(source, 'PSL_TAGGED_LITERAL_TOO_LARGE', 'Tagged literal exceeds 65536 bytes.'),
    );
  });

  it('refuses a tag the stack does not register, listing the known tags', () => {
    const source = 'pg.sql`x`';
    expect(parse(sqlExpression.id, source)).toEqual(
      refusal(
        source,
        'PSL_UNKNOWN_LITERAL_TAG',
        'Unknown literal tag "pg.sql". Known tags: sql, json.',
      ),
    );
  });

  it('refuses a plain value the target has no data type for', () => {
    const noText: DataTypeSupport = {
      entries: { [sqlExpression.id]: entries[sqlExpression.id] ?? fail() },
      lookup: support.lookup,
    };
    const source = '"x"';
    expect(parse(sqlExpression.id, source, noText)).toEqual(
      refusal(
        source,
        'PSL_VALUE_TYPE_INCOMPATIBLE',
        'Expected sql`...`; this target has no data type for a string value',
      ),
    );
  });

  it('refuses text the entry of its tag cannot read', () => {
    const source = 'json`{`';
    const result = parse(sqlExpression.id, source);
    expect(result).toEqual(refusal(source, 'PSL_INVALID_LITERAL', messageOfJsonParse('{')));
  });

  it('refuses a string for a type with a tag, ending with the exact rewrite', () => {
    const source = '"(archived_at IS NULL)"';
    expect(parse(sqlExpression.id, source)).toEqual(
      refusal(
        source,
        'PSL_VALUE_TYPE_INCOMPATIBLE',
        'Expected sql`...`; write sql`(archived_at IS NULL)`',
      ),
    );
  });

  it('writes the rewrite of a string holding a backtick in the double-quote form', () => {
    const source = '"a `b`"';
    expect(parse(sqlExpression.id, source)).toEqual(
      refusal(source, 'PSL_VALUE_TYPE_INCOMPATIBLE', 'Expected sql`...`; write sql"a `b`"'),
    );
  });

  it.each([
    ['indented text', '"  a = 1"'],
    ['a carriage return', '"a = 1\\r\\nAND b = 2"'],
    ['a blank last line', '"a = 1\\n"'],
  ])(
    'refuses a string holding %s without a rewrite that would read back differently',
    (_, source) => {
      expect(parse(sqlExpression.id, source)).toEqual(
        refusal(source, 'PSL_VALUE_TYPE_INCOMPATIBLE', 'Expected sql`...`'),
      );
    },
  );

  it.each([['42'], ['true']])(
    'refuses %s for a type with a tag by naming its written form',
    (source) => {
      expect(parse(sqlExpression.id, source)).toEqual(
        refusal(source, 'PSL_VALUE_TYPE_INCOMPATIBLE', 'Expected sql`...`'),
      );
    },
  );

  it('refuses a string for a type without a tag by naming its written form', () => {
    const source = '"8"';
    expect(parse(pgInt4.id, source)).toEqual(
      refusal(source, 'PSL_VALUE_TYPE_INCOMPATIBLE', 'Expected a number'),
    );
  });

  it('refuses a string for a type with a tag without a rewrite when the literal would not read back', () => {
    const source = '"  (archived_at IS NULL)"';
    expect(parse(sqlExpression.id, source)).toEqual(
      refusal(source, 'PSL_VALUE_TYPE_INCOMPATIBLE', 'Expected sql`...`'),
    );
  });

  it('refuses a number of the right form too large for the type, naming both types', () => {
    const source = '40000';
    expect(parse(pgInt2.id, source)).toEqual(
      refusal(
        source,
        'PSL_VALUE_TYPE_INCOMPATIBLE',
        'Expected a number that pg/int2 can hold; got pg/int4',
      ),
    );
  });

  it('refuses a value its cast throws on, with the error message', () => {
    const source = '"not-a-uuid"';
    expect(parse(pgUuid.id, source)).toEqual(
      refusal(source, 'PSL_INVALID_LITERAL', '"not-a-uuid" is not a UUID.'),
    );
  });

  it('builds for a type the stack does not register, and throws an internal error when parsing', () => {
    const missing = dataTypeId('postgis/geometry');
    const type = dataTypeValue(missing, support);
    expect({ label: type.label, tags: type.tags, documentation: type.documentation }).toEqual({
      label: 'no written form',
      tags: [],
      documentation: '',
    });
    const { expr, ctx } = argOf('"POINT(0 0)"');
    expect(() => type.parse(expr, ctx)).toThrow(
      new InternalError(
        'An argument receives data type "postgis/geometry", which this stack does not register.',
      ),
    );
    expect(() => type.parse(expr, ctx)).toThrow(InternalError);
  });

  it('throws an internal error when parsing for a registered type that nothing writes', () => {
    const pgBlob = dataType('pg/blob', {});
    const withBlob: DataTypeSupport = { entries, lookup: createDataTypeLookup([pgBlob]) };
    const { expr, ctx } = argOf('"x"');
    expect(() => dataTypeValue(pgBlob.id, withBlob).parse(expr, ctx)).toThrow(
      new InternalError(
        'An argument receives data type "pg/blob", which nothing in this stack writes.',
      ),
    );
  });

  it.each([
    ['a single-line string', '"(archived_at IS NULL)"', '(archived_at IS NULL)'],
    ['a string holding a backtick', '"a `b`"', 'a `b`'],
    ['a string holding a backslash', '"a\\\\b"', 'a\\b'],
    ['a multi-line string', '"(now()\\n  + 1)"', '(now()\n  + 1)'],
  ])('offers a rewrite of %s that parses back as the same text', (_name, source, text) => {
    const refused = parse(sqlExpression.id, source);
    const message = refused.ok ? '' : (refused.failure[0]?.message ?? '');
    const [, rewrite] = message.split('; write ');
    expect(rewrite).toBeDefined();
    expect(parse(sqlExpression.id, rewrite ?? '')).toMatchObject(
      ok({ type: 'sql/expression', value: text }),
    );
  });

  describe('as a parameter of a function call that is an arm of oneOf', () => {
    const value = oneOf(
      str(),
      funcCall('nanoid', {
        documentation: 'A random identifier.',
        positional: [
          {
            key: 'length',
            type: dataTypeValue(pgInt4.id, support),
            documentation: 'The number of characters.',
          },
        ],
      }),
    );

    it('returns the typed value in the call arguments', () => {
      const { expr, ctx } = argOf('nanoid(8)');
      expect(value.parse(expr, ctx)).toEqual(
        ok({
          fn: 'nanoid',
          span: {
            start: { offset: 3, line: 1, column: 4 },
            end: { offset: 12, line: 1, column: 13 },
          },
          args: {
            length: {
              type: 'pg/int4',
              value: '8',
              span: {
                start: { offset: 10, line: 1, column: 11 },
                end: { offset: 11, line: 1, column: 12 },
              },
            },
          },
        }),
      );
    });

    it('reports a refused argument at the written value when the call is parsed alone', () => {
      const { expr, ctx } = argOf('nanoid("8")');
      expect(value.alternatives[1].parse(expr, ctx)).toEqual(
        notOk([
          {
            code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
            message: 'Expected a number',
            filename: 'schema.prisma',
            range: { start: { line: 0, character: 10 }, end: { line: 0, character: 13 } },
          },
        ]),
      );
    });

    it('takes the other arm for a value that is not a call', () => {
      const { expr, ctx } = argOf('"x"');
      expect(value.parse(expr, ctx)).toEqual(ok('x'));
    });
  });
});

describe('oneOf given a call to a function one arm names', () => {
  const nanoid = funcCall('nanoid', {
    documentation: 'A random identifier.',
    positional: [
      {
        key: 'length',
        type: dataTypeValue(pgInt4.id, support),
        documentation: 'The number of characters.',
      },
    ],
  });
  const value = oneOf(nanoid, str());

  it('reports the refused argument of that function at the written value', () => {
    const { expr, ctx } = argOf('nanoid("8")');
    expect(value.parse(expr, ctx)).toEqual(
      notOk([
        {
          code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
          message: 'Expected a number',
          filename: 'schema.prisma',
          range: { start: { line: 0, character: 10 }, end: { line: 0, character: 13 } },
        },
      ]),
    );
  });

  it('returns the typed value of that function', () => {
    const { expr, ctx } = argOf('nanoid(8)');
    expect(value.parse(expr, ctx)).toEqual(
      ok({
        fn: 'nanoid',
        span: {
          start: { offset: 3, line: 1, column: 4 },
          end: { offset: 12, line: 1, column: 13 },
        },
        args: {
          length: {
            type: 'pg/int4',
            value: '8',
            span: {
              start: { offset: 10, line: 1, column: 11 },
              end: { offset: 11, line: 1, column: 12 },
            },
          },
        },
      }),
    );
  });

  it('lists the arms for a call to a function no arm names', () => {
    const source = 'other(1)';
    const { expr, ctx } = argOf(source);
    expect(value.parse(expr, ctx)).toEqual(
      refusal(source, 'PSL_INVALID_ATTRIBUTE_SYNTAX', 'Expected one of: nanoid() | string'),
    );
  });

  it('lists the arms for a dotted callee', () => {
    const source = 'foo.nanoid("8")';
    const { expr, ctx } = argOf(source);
    expect(value.parse(expr, ctx)).toEqual(
      refusal(source, 'PSL_INVALID_ATTRIBUTE_SYNTAX', 'Expected one of: nanoid() | string'),
    );
  });

  it('lists the arms for a colon-qualified callee', () => {
    const source = 'a:nanoid("8")';
    const { expr, ctx } = colonQualifiedArgOf(source);
    expect(value.parse(expr, ctx)).toEqual(
      refusal(source, 'PSL_INVALID_ATTRIBUTE_SYNTAX', 'Expected one of: nanoid() | string'),
    );
  });

  it('lists the arms when two arms name the function', () => {
    const twoNanoids = oneOf(
      nanoid,
      funcCall('nanoid', {
        documentation: 'A random identifier with an alphabet.',
        positional: [{ key: 'alphabet', type: str(), documentation: 'The alphabet.' }],
      }),
    );
    const source = 'nanoid(true)';
    const { expr, ctx } = argOf(source);
    expect(twoNanoids.parse(expr, ctx)).toEqual(
      refusal(source, 'PSL_INVALID_ATTRIBUTE_SYNTAX', 'Expected one of: nanoid() | nanoid()'),
    );
  });
});

function fail(): never {
  throw new Error('expected the sql/expression entry');
}

function messageOfJsonParse(text: string): string {
  try {
    JSON.parse(text);
  } catch (error) {
    if (error instanceof Error) return error.message;
  }
  throw new Error(`expected ${text} not to parse as JSON`);
}
