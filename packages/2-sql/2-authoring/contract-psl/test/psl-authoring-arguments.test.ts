import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { AuthoringArgumentDescriptor } from '@internal/framework-components/authoring';
import type { PslSpan, ResolvedAttributeArg } from '@internal/psl-parser';
import { createPslDiagnosticCollector, diagnosticSource } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { mapPslHelperArgs } from '../src/psl-authoring-arguments';

const SPAN: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

function positional(value: string): ResolvedAttributeArg {
  return { kind: 'positional', value, span: SPAN };
}

function named(name: string, value: string): ResolvedAttributeArg {
  return { kind: 'named', name, value, span: SPAN };
}

function callMap(
  args: readonly ResolvedAttributeArg[],
  descriptors: readonly AuthoringArgumentDescriptor[],
): { result: readonly unknown[] | undefined; diagnostics: ContractSourceDiagnostic[] } {
  const { document, sources } = parse('', 'schema.prisma');
  const diagnostics = createPslDiagnosticCollector(sources);
  const result = mapPslHelperArgs({
    args,
    descriptors,
    helperLabel: 'helper "test"',
    span: SPAN,
    diagnostics,
    source: diagnosticSource(sources, document.syntax),
    entityLabel: 'Field "Model.field"',
  });
  return { result, diagnostics: diagnostics.toExternal() };
}

describe('mapPslHelperArgs argument kinds', () => {
  it('unquotes a string-kind argument', () => {
    const { result, diagnostics } = callMap([positional('"hello"')], [{ kind: 'string' }]);
    expect(result).toEqual(['hello']);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a boolean-kind argument', () => {
    expect(callMap([positional('true')], [{ kind: 'boolean' }]).result).toEqual([true]);
    expect(callMap([positional('false')], [{ kind: 'boolean' }]).result).toEqual([false]);
  });

  it('rejects a boolean-kind argument that is neither true nor false', () => {
    const { result, diagnostics } = callMap([positional('maybe')], [{ kind: 'boolean' }]);
    expect(result).toBeUndefined();
    expect(diagnostics[0]?.message).toMatch(/cannot parse argument #1/);
  });

  it('parses a number-kind argument', () => {
    expect(callMap([positional('42')], [{ kind: 'number' }]).result).toEqual([42]);
    expect(callMap([positional('-3.5')], [{ kind: 'number' }]).result).toEqual([-3.5]);
  });

  it('rejects a number-kind argument that does not parse to a number', () => {
    const { result, diagnostics } = callMap([positional('not-a-number')], [{ kind: 'number' }]);
    expect(result).toBeUndefined();
    expect(diagnostics[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_ARGUMENT');
  });

  it('parses a stringArray-kind argument', () => {
    const { result, diagnostics } = callMap(
      [positional('["a", "b", "c"]')],
      [{ kind: 'stringArray' }],
    );
    expect(result).toEqual([['a', 'b', 'c']]);
    expect(diagnostics).toHaveLength(0);
  });

  it('rejects a stringArray-kind argument that is not an array literal', () => {
    const { result, diagnostics } = callMap([positional('{a: 1}')], [{ kind: 'stringArray' }]);
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('rejects a stringArray-kind argument containing a non-string element', () => {
    const { result, diagnostics } = callMap([positional('[1, 2]')], [{ kind: 'stringArray' }]);
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('parses an object-kind argument as strict JSON', () => {
    const { result, diagnostics } = callMap(
      [positional('{"a": "b", "n": 1}')],
      [{ kind: 'object', properties: {} }],
    );
    expect(result).toEqual([{ a: 'b', n: 1 }]);
    expect(diagnostics).toHaveLength(0);
  });

  it('falls back to the JS-like literal parser when an object-kind argument is not strict JSON', () => {
    const { result, diagnostics } = callMap(
      [positional("{a: 'b', n: 2}")],
      [{ kind: 'object', properties: {} }],
    );
    expect(result).toEqual([{ a: 'b', n: 2 }]);
    expect(diagnostics).toHaveLength(0);
  });

  it('rejects an object-kind argument that is not brace-delimited', () => {
    const { result, diagnostics } = callMap(
      [positional('[1, 2]')],
      [{ kind: 'object', properties: {} }],
    );
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('rejects an object-kind argument that fails both JSON and JS-like parsing', () => {
    const { result, diagnostics } = callMap(
      [positional('{a: }')],
      [{ kind: 'object', properties: {} }],
    );
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('parses an option-kind argument as a bare token', () => {
    const { result, diagnostics } = callMap(
      [positional('now')],
      [{ kind: 'option', values: ['now'] }],
    );
    expect(result).toEqual(['now']);
    expect(diagnostics).toHaveLength(0);
  });

  it('rejects a quoted string for an option-kind argument', () => {
    const { result, diagnostics } = callMap(
      [positional('"now"')],
      [{ kind: 'option', values: ['now'] }],
    );
    expect(result).toBeUndefined();
    expect(diagnostics[0]?.message).toMatch(/cannot parse argument #1/);
  });

  it('rejects a number for an option-kind argument', () => {
    const { result, diagnostics } = callMap(
      [positional('1')],
      [{ kind: 'option', values: ['now'] }],
    );
    expect(result).toBeUndefined();
    expect(diagnostics[0]?.message).toMatch(/cannot parse argument #1/);
  });

  it('rejects an object for an option-kind argument', () => {
    const { result, diagnostics } = callMap(
      [positional('{a: 1}')],
      [{ kind: 'option', values: ['now'] }],
    );
    expect(result).toBeUndefined();
    expect(diagnostics[0]?.message).toMatch(/cannot parse argument #1/);
  });

  it('rejects an unsupported descriptor kind', () => {
    const bogusDescriptor = { kind: 'bogus' } as unknown as AuthoringArgumentDescriptor;
    const { result, diagnostics } = callMap([positional('anything')], [bogusDescriptor]);
    expect(result).toBeUndefined();
    expect(diagnostics[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_ARGUMENT');
  });
});

describe('mapPslHelperArgs JS-like object/array literal parsing', () => {
  const objectDescriptor: AuthoringArgumentDescriptor = { kind: 'object', properties: {} };

  function parseObjectLiteral(raw: string) {
    return callMap([positional(raw)], [objectDescriptor]).result?.[0];
  }

  it('parses nested arrays and objects', () => {
    expect(parseObjectLiteral("{list: [1, 'two', [3, 4], {nested: true}], empty: []}")).toEqual({
      list: [1, 'two', [3, 4], { nested: true }],
      empty: [],
    });
  });

  it('parses the true/false/null identifiers', () => {
    expect(parseObjectLiteral('{a: true, b: false, c: null}')).toEqual({
      a: true,
      b: false,
      c: null,
    });
  });

  it('parses numeric literals: negative, decimal, and exponent forms', () => {
    expect(parseObjectLiteral('{a: -3, b: 1.5, c: 2e3, d: 0}')).toEqual({
      a: -3,
      b: 1.5,
      c: 2000,
      d: 0,
    });
  });

  it('parses every recognized string escape sequence', () => {
    expect(parseObjectLiteral("{s: 'a\\'\\\"\\\\\\/\\b\\f\\n\\r\\t\\u0041'}")).toEqual({
      s: 'a\'"\\/\b\f\n\r\tA',
    });
  });

  it('rejects an unrecognized escape sequence', () => {
    const { result, diagnostics } = callMap([positional("{s: 'bad\\qend'}")], [objectDescriptor]);
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('rejects an invalid unicode escape', () => {
    const { result, diagnostics } = callMap([positional("{s: '\\u12zz'}")], [objectDescriptor]);
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('rejects a string literal with no closing quote', () => {
    const { result, diagnostics } = callMap([positional("{s: 'unterminated}")], [objectDescriptor]);
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('rejects a bare identifier that is not true, false, or null', () => {
    const { result, diagnostics } = callMap([positional('{a: undefined}')], [objectDescriptor]);
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('rejects an object literal with an invalid key', () => {
    const { result, diagnostics } = callMap([positional('{1abc: "x"}')], [objectDescriptor]);
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('rejects an object literal missing a colon after the key', () => {
    const { result, diagnostics } = callMap([positional('{a "x"}')], [objectDescriptor]);
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('rejects an object literal with a trailing comma', () => {
    const { result, diagnostics } = callMap([positional("{a: 'x',}")], [objectDescriptor]);
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('rejects an unclosed object literal', () => {
    const { result, diagnostics } = callMap([positional("{a: 'x'")], [objectDescriptor]);
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('rejects an unclosed array literal', () => {
    expect(callMap([positional('{list: [1, 2}')], [objectDescriptor]).result).toBeUndefined();
  });

  it('rejects trailing content after a complete literal', () => {
    const { result, diagnostics } = callMap([positional('{a: 1} garbage')], [objectDescriptor]);
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });
});

describe('mapPslHelperArgs positional/named dispatch', () => {
  const descriptors: readonly AuthoringArgumentDescriptor[] = [
    { kind: 'number', name: 'x' },
    { kind: 'string', name: 'y' },
  ];

  it('maps positional arguments in order', () => {
    const { result, diagnostics } = callMap([positional('1'), positional('"two"')], descriptors);
    expect(result).toEqual([1, 'two']);
    expect(diagnostics).toHaveLength(0);
  });

  it('maps named arguments by descriptor name, in any order', () => {
    const { result, diagnostics } = callMap([named('y', '"two"'), named('x', '1')], descriptors);
    expect(result).toEqual([1, 'two']);
    expect(diagnostics).toHaveLength(0);
  });

  it('rejects more positional arguments than the helper declares', () => {
    const { result, diagnostics } = callMap(
      [positional('1'), positional('"two"'), positional('"extra"')],
      descriptors,
    );
    expect(result).toBeUndefined();
    expect(diagnostics[0]?.message).toMatch(/accepts at most 2 argument\(s\), received 3/);
  });

  it('rejects a named argument that does not match any descriptor', () => {
    const { result, diagnostics } = callMap([named('z', '1')], descriptors);
    expect(result).toBeUndefined();
    expect(diagnostics[0]?.message).toMatch(/received unknown named argument "z"/);
  });

  it('rejects a named argument that duplicates an already-supplied positional value', () => {
    const { result, diagnostics } = callMap([positional('1'), named('x', '2')], descriptors);
    expect(result).toBeUndefined();
    expect(diagnostics[0]?.message).toMatch(/received duplicate value for argument "x"/);
  });

  it('rejects a named argument whose value fails to parse for its descriptor kind', () => {
    const { result, diagnostics } = callMap([named('x', 'not-a-number')], descriptors);
    expect(result).toBeUndefined();
    expect(diagnostics[0]?.message).toMatch(/cannot parse named argument "x"/);
  });

  it('leaves an optional trailing descriptor unset when no argument supplies it', () => {
    const { result, diagnostics } = callMap([positional('1')], descriptors);
    expect(result).toEqual([1, undefined]);
    expect(diagnostics).toHaveLength(0);
  });

  it('rejects a positional argument at an index the descriptor array does not define', () => {
    const sparseDescriptors = [
      undefined,
      { kind: 'string', name: 'y' },
    ] as unknown as readonly AuthoringArgumentDescriptor[];
    const { result, diagnostics } = callMap(
      [positional('"x"'), positional('"y"')],
      sparseDescriptors,
    );
    expect(result).toBeUndefined();
    expect(diagnostics[0]?.message).toMatch(/does not define positional argument #1/);
  });
});
