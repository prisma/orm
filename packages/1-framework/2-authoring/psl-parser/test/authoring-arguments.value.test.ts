import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type {
  AuthoringArgumentDescriptor,
  AuthoringTypeChoiceOption,
  DataTypeAuthoringEntry,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import { createDataTypeLookup, dataType } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { mapPslHelperArgs } from '../src/authoring-arguments';
import { createPslDiagnosticCollector, diagnosticSource } from '../src/diagnostic';
import { Cursor, parse, parseAttribute } from '../src/parse';
import { readResolvedAttribute } from '../src/resolve';
import { PslSources } from '../src/source-file';
import { FieldAttributeAst } from '../src/syntax/ast/attributes';
import { createSyntaxTree } from '../src/syntax/red';

const sqlExpression = dataType('sql/expression', { read: (json) => json });
const pgText = dataType('pg/text', { read: (json) => json });
const pgInt2 = dataType('pg/int2', { read: (json) => json });
const pgInt8 = dataType('pg/int8', { read: (json) => json });
const pgNumeric = dataType('pg/numeric', { read: (json) => json });
const pgInt4 = dataType('pg/int4', {
  read: (json) => json,
  casts: { [pgInt2.id]: (value) => value },
});

const entries: Readonly<Record<string, DataTypeAuthoringEntry>> = {
  [sqlExpression.id]: {
    written: { kind: 'tag', tag: 'sql', parse: (text) => text },
    print: String,
    documentation: 'A SQL expression.',
  },
  [pgText.id]: {
    written: { kind: 'plain', syntax: 'string', parse: (text) => text },
    print: String,
    documentation: 'Text.',
  },
  [pgNumeric.id]: {
    written: {
      kind: 'plain',
      syntax: 'number',
      types: [pgInt2.id, pgInt8.id, pgNumeric.id],
      classify: (text) => {
        if (!/^-?\d+$/.test(text)) return { type: pgNumeric.id, value: text };
        const value = Number(text);
        return Math.abs(value) < 32768
          ? { type: pgInt2.id, value }
          : { type: pgInt8.id, value: text };
      },
    },
    print: String,
    documentation: 'A number.',
  },
};

const support: DataTypeSupport = {
  entries,
  lookup: createDataTypeLookup([sqlExpression, pgText, pgInt2, pgInt4, pgInt8, pgNumeric]),
  dataTypeOfCodec: () => undefined,
};

const length = { kind: 'value', dataType: 'pg/int4', name: 'length', optional: true } as const;
const definition = { kind: 'value', dataType: 'sql/expression', name: 'sql' } as const;

function callWith(
  argumentText: string,
  descriptors: readonly (AuthoringArgumentDescriptor | AuthoringTypeChoiceOption)[],
): { result: readonly unknown[] | undefined; diagnostics: ContractSourceDiagnostic[] } {
  const cursor = new Cursor('schema.prisma', `@x(${argumentText})`);
  const root = createSyntaxTree(parseAttribute(cursor));
  const attribute = FieldAttributeAst.cast(root);
  if (attribute === undefined) throw new Error('expected an attribute');
  const sources = new PslSources([[root, cursor.sourceFile]]);
  const diagnostics = createPslDiagnosticCollector(sources);
  const call = readResolvedAttribute(attribute, sources);
  const result = mapPslHelperArgs({
    args: call.args,
    descriptors,
    helperLabel: 'constructor "Sized"',
    span: call.span,
    diagnostics,
    source: diagnosticSource(sources, root),
    entityLabel: 'Field "Model.field"',
    dataTypes: support,
  });
  return { result, diagnostics: diagnostics.toExternal() };
}

/** The diagnostic at the argument text `written`, which starts at column `from` of `@x(...)`. */
function refusedAt(from: number, written: string, code: string, message: string) {
  return {
    result: undefined,
    diagnostics: [
      {
        code,
        message,
        sourceId: 'schema.prisma',
        span: {
          start: { offset: from, line: 1, column: from + 1 },
          end: { offset: from + written.length, line: 1, column: from + written.length + 1 },
        },
      },
    ],
  };
}

describe('mapPslHelperArgs on a value argument', () => {
  it('reads a number that its data type holds, through a cast', () => {
    expect(callWith('255', [length])).toEqual({ result: [255], diagnostics: [] });
  });

  it('reads a named value argument', () => {
    expect(callWith('length: 10', [length])).toEqual({ result: [10], diagnostics: [] });
  });

  it('reads a sql literal as the text of a sql/expression value', () => {
    expect(callWith('sql`"MyType"[]`', [definition])).toEqual({
      result: ['"MyType"[]'],
      diagnostics: [],
    });
  });

  it('refuses a number its data type cannot hold, naming both types', () => {
    expect(callWith('3000000000', [length])).toEqual(
      refusedAt(
        3,
        '3000000000',
        'PSL_VALUE_TYPE_INCOMPATIBLE',
        'Expected a number that pg/int4 can hold; got pg/int8',
      ),
    );
  });

  it('refuses a number with a fraction', () => {
    expect(callWith('2.5', [length])).toEqual(
      refusedAt(
        3,
        '2.5',
        'PSL_VALUE_TYPE_INCOMPATIBLE',
        'Expected a number that pg/int4 can hold; got pg/numeric',
      ),
    );
  });

  it('refuses a quoted number', () => {
    expect(callWith('"255"', [length])).toEqual(
      refusedAt(3, '"255"', 'PSL_VALUE_TYPE_INCOMPATIBLE', 'Expected a number; write 255'),
    );
  });

  it('refuses a quoted string where a sql literal goes, with the literal to write', () => {
    expect(callWith('"ltree"', [definition])).toEqual(
      refusedAt(3, '"ltree"', 'PSL_VALUE_TYPE_INCOMPATIBLE', 'Expected sql`...`; write sql`ltree`'),
    );
  });

  it('refuses an identifier at the value, not at the argument name', () => {
    expect(callWith('sql: ltree', [definition])).toEqual(
      refusedAt(8, 'ltree', 'PSL_INVALID_ATTRIBUTE_SYNTAX', 'Expected sql`...`; got an identifier'),
    );
  });

  it('refuses a tag the stack does not know', () => {
    expect(callWith('json`{}`', [definition])).toEqual(
      refusedAt(
        3,
        'json`{}`',
        'PSL_UNKNOWN_LITERAL_TAG',
        'Unknown literal tag "json". Known tags: sql.',
      ),
    );
  });
});

describe('mapPslHelperArgs on a value argument with no expression', () => {
  it('throws an internal error, because a reader built the argument from text', () => {
    const { document, sources } = parse('', 'schema.prisma');
    const span = {
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 0, line: 1, column: 1 },
    };
    expect(() =>
      mapPslHelperArgs({
        args: [{ kind: 'positional', value: '255', span }],
        descriptors: [length],
        helperLabel: 'constructor "Sized"',
        span,
        diagnostics: createPslDiagnosticCollector(sources),
        source: diagnosticSource(sources, document.syntax),
        entityLabel: 'Field "Model.field"',
        dataTypes: support,
      }),
    ).toThrow(
      expect.objectContaining({
        name: 'InternalError',
        message: expect.stringContaining('received argument #1 with no expression'),
      }),
    );
  });
});

describe('a number written where an option is expected', () => {
  const option = {
    kind: 'option',
    name: 'as',
    values: ['string', 'temporal'],
    default: 'string',
    optional: true,
  } as const;
  const message = (refusal: { diagnostics: ContractSourceDiagnostic[] }) =>
    refusal.diagnostics[0]?.message;

  it('says to write the one value argument that takes a number by name', () => {
    expect(message(callWith('3', [option, { ...length, name: 'precision' }]))).toBe(
      'Field "Model.field" constructor "Sized" argument #1 is 3, but argument "as" takes one of these names, written without quotes: string, temporal. Write precision by name, as in precision: 3.',
    );
  });

  it('says only which names the option takes when no value argument takes a number', () => {
    const label = { kind: 'value', dataType: 'pg/text', name: 'label', optional: true } as const;
    expect(message(callWith('3', [option, label]))).toBe(
      'Field "Model.field" constructor "Sized" argument #1 is 3, but argument "as" takes one of these names, written without quotes: string, temporal.',
    );
  });

  it('says only which names the option takes when two value arguments take a number', () => {
    expect(message(callWith('3', [option, length, { ...length, name: 'scale' }]))).toBe(
      'Field "Model.field" constructor "Sized" argument #1 is 3, but argument "as" takes one of these names, written without quotes: string, temporal.',
    );
  });
});

describe('mapPslHelperArgs positional and named dispatch', () => {
  const descriptors = [
    { kind: 'value', dataType: 'pg/int4', name: 'x' },
    { kind: 'value', dataType: 'pg/text', name: 'y', optional: true },
  ] as const;

  it('maps positional arguments in order', () => {
    expect(callWith('1, "two"', descriptors)).toEqual({ result: [1, 'two'], diagnostics: [] });
  });

  it('maps named arguments by descriptor name, in any order', () => {
    expect(callWith('y: "two", x: 1', descriptors)).toEqual({
      result: [1, 'two'],
      diagnostics: [],
    });
  });

  it('maps a positional argument written after a named one to the first parameter', () => {
    expect(callWith('y: "two", 1', descriptors)).toEqual({ result: [1, 'two'], diagnostics: [] });
  });

  it('rejects a named argument for a parameter a later positional argument fills', () => {
    const { result, diagnostics } = callWith('x: 2, 1', descriptors);
    expect(result).toBeUndefined();
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Field "Model.field" constructor "Sized" received duplicate value for argument "x".',
    ]);
  });

  it('leaves an optional trailing descriptor unset when no argument supplies it', () => {
    expect(callWith('1', descriptors)).toEqual({ result: [1, undefined], diagnostics: [] });
  });

  it('rejects more positional arguments than the helper declares', () => {
    const { result, diagnostics } = callWith('1, "two", 3', descriptors);
    expect(result).toBeUndefined();
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Field "Model.field" constructor "Sized" accepts at most 2 argument(s), received 3.',
    ]);
  });

  it('rejects a named argument that does not match any descriptor', () => {
    const { result, diagnostics } = callWith('z: 1', descriptors);
    expect(result).toBeUndefined();
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Field "Model.field" constructor "Sized" received unknown named argument "z".',
    ]);
  });

  it('rejects a named argument that duplicates an already-supplied positional value', () => {
    const { result, diagnostics } = callWith('1, x: 2', descriptors);
    expect(result).toBeUndefined();
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Field "Model.field" constructor "Sized" received duplicate value for argument "x".',
    ]);
  });

  it('reports a bad value before a bad name in the same call', () => {
    expect(callWith('"bad", z: 1', descriptors).diagnostics.map((d) => d.message)).toEqual([
      'Expected a number',
    ]);
  });

  it('reports a bad named value before a later bad name', () => {
    expect(callWith('y: 2, z: 1', descriptors).diagnostics.map((d) => d.message)).toEqual([
      'Expected a quoted string',
    ]);
  });

  it('rejects a positional argument at an index the descriptor array does not define', () => {
    const sparseDescriptors = [
      undefined,
      descriptors[1],
    ] as unknown as readonly AuthoringArgumentDescriptor[];
    const { result, diagnostics } = callWith('1, "two"', sparseDescriptors);
    expect(result).toBeUndefined();
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Field "Model.field" constructor "Sized" does not define positional argument #1.',
    ]);
  });
});
