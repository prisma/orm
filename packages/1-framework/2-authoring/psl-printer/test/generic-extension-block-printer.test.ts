/**
 * Tests for the generic framework printer for extension-contributed PSL blocks (P2, TML-2854).
 *
 * The printer reads the descriptor's `parameters` map and renders each block
 * generically — no contributed `printer` function. Four parameter kinds:
 *   - `ref`    → identifier token
 *   - `value`  → codec JSON medium round-trip via `encodeJson(decodeJson(JSON.parse(raw)))`
 *   - `option` → literal token
 *   - `list`   → bracketed comma-separated rendered elements
 *
 * Exercises:
 *   1. A `policy_select` node with all four parameter kinds renders to the expected PSL text.
 *   2. A node whose discriminator has no registered descriptor throws.
 *   3. Built-in print round-trip is unchanged (enums, models).
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  voidParamsSchema,
} from '@internal/framework-components/codec';
import {
  assembleAuthoringContributions,
  extractCodecLookup,
} from '@internal/framework-components/control';
import type {
  PslExtensionBlock,
  PslExtensionBlockParamList,
  PslExtensionBlockParamOption,
  PslExtensionBlockParamRef,
  PslExtensionBlockParamScalarValue,
  PslModel,
} from '@internal/framework-components/psl-ast';
import {
  makePslNamespace,
  makePslNamespaceEntries,
  UNSPECIFIED_PSL_NAMESPACE_ID,
} from '@internal/framework-components/psl-ast';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';
import {
  declarativePolicySelectContributions,
  FIXTURE_POLICY_CODEC_ID,
} from './fixtures/declarative-policy-select-extension';

// ---------------------------------------------------------------------------
// Stub codec — matches the one in the round-trip test
// ---------------------------------------------------------------------------

class StubPolicyTextCodec extends CodecImpl<
  typeof FIXTURE_POLICY_CODEC_ID,
  readonly ['textual'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

class StubPolicyTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = FIXTURE_POLICY_CODEC_ID as typeof FIXTURE_POLICY_CODEC_ID;
  override readonly traits = ['textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => StubPolicyTextCodec {
    return () => new StubPolicyTextCodec(this);
  }
}

const stubDescriptor = new StubPolicyTextDescriptor();

const codecLookup = extractCodecLookup([
  {
    id: 'fixture-policy-ext',
    types: { codecTypes: { codecDescriptors: [stubDescriptor] } },
  },
]);

const assembled = assembleAuthoringContributions([
  { authoring: declarativePolicySelectContributions },
]);

// ---------------------------------------------------------------------------
// Helpers to build minimal PslExtensionBlock nodes for printer tests
// ---------------------------------------------------------------------------

const STUB_SPAN = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 1, line: 1, column: 2 },
} as const;

function makeNs(models: PslModel[], extensionBlocks: PslExtensionBlock[]) {
  return makePslNamespace({
    kind: 'namespace',
    name: UNSPECIFIED_PSL_NAMESPACE_ID,
    entries: makePslNamespaceEntries(models, [], extensionBlocks),
    span: STUB_SPAN,
  });
}

function refParam(identifier: string): PslExtensionBlockParamRef {
  return { kind: 'ref', identifier, span: STUB_SPAN };
}

function valueParam(raw: string): PslExtensionBlockParamScalarValue {
  return { kind: 'value', raw, span: STUB_SPAN };
}

function optionParam(token: string): PslExtensionBlockParamOption {
  return { kind: 'option', token, span: STUB_SPAN };
}

function listParam(items: readonly PslExtensionBlockParamRef[]): PslExtensionBlockParamList {
  return { kind: 'list', items, span: STUB_SPAN };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generic extension-block printer (P2)', () => {
  describe('policy_select block with ref, value, option, and list parameters', () => {
    it('renders all four parameter kinds to the expected PSL text', () => {
      const block: PslExtensionBlock = {
        kind: 'fixture-policy-select',
        keyword: 'policy_select',
        name: 'ProfilesSelect',
        parameters: {
          target: refParam('Post'),
          as: optionParam('permissive'),
          roles: listParam([refParam('AdminRole'), refParam('EditorRole')]),
          using: valueParam('"auth.uid() = author_id"'),
        },
        blockAttributes: [],
        attributes: {},
        span: STUB_SPAN,
      };

      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs([], [block])],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(ast, {
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      expect(output).toContain('policy_select ProfilesSelect {');
      expect(output).toContain('  target = Post');
      expect(output).toContain('  as = permissive');
      expect(output).toContain('  roles = [AdminRole, EditorRole]');
      expect(output).toContain('  using = "auth.uid() = author_id"');
      expect(output).toContain('}');
    });

    it('renders a block with only required parameters (omits absent optional params)', () => {
      const block: PslExtensionBlock = {
        kind: 'fixture-policy-select',
        keyword: 'policy_select',
        name: 'MinimalSelect',
        parameters: {
          target: refParam('User'),
          using: valueParam('"true"'),
        },
        blockAttributes: [],
        attributes: {},
        span: STUB_SPAN,
      };

      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs([], [block])],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(ast, {
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      expect(output).toContain('policy_select MinimalSelect {');
      expect(output).toContain('  target = User');
      expect(output).toContain('  using = "true"');
      expect(output).not.toContain('as =');
      expect(output).not.toContain('roles =');
    });
  });

  // The codec — not the captured raw text — owns the serialized form of a value
  // parameter. This is the print-back mirror of Slice 1's parse-side validator
  // (`decodeJson(JSON.parse(raw))`): printing runs the value through the codec's
  // JSON medium, `JSON.stringify(encodeJson(decodeJson(JSON.parse(raw))))`. The
  // identity stub codec above can't distinguish "echo the raw" from "round-trip
  // through the codec", so this block uses a codec whose encodeJson produces a
  // different JSON shape than the raw input — a value that came from an IR/value
  // source rather than parsed text would be serialized the same way.
  describe('value parameter serialized through the codec (not echoed from raw)', () => {
    class NumericExpressionCodec extends CodecImpl<
      typeof FIXTURE_POLICY_CODEC_ID,
      readonly ['numeric'],
      number,
      number
    > {
      async encode(value: number, _ctx: CodecCallContext): Promise<number> {
        return value;
      }
      async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
        return wire;
      }
      // A quoted "42" or a bare 42 both decode to the number 42 …
      decodeJson(json: JsonValue): number {
        return typeof json === 'number' ? json : Number(json);
      }
      // … and re-encode to a bare JSON number, which prints unquoted.
      encodeJson(value: number): JsonValue {
        return value;
      }
    }

    class NumericExpressionDescriptor extends CodecDescriptorImpl<void> {
      override readonly codecId = FIXTURE_POLICY_CODEC_ID as typeof FIXTURE_POLICY_CODEC_ID;
      override readonly traits = ['numeric'] as const;
      override readonly targetTypes = ['numeric'] as const;
      override readonly paramsSchema = voidParamsSchema;
      override factory(): (ctx: CodecInstanceContext) => NumericExpressionCodec {
        return () => new NumericExpressionCodec(this);
      }
    }

    const numericCodecLookup = extractCodecLookup([
      {
        id: 'fixture-policy-ext',
        types: { codecTypes: { codecDescriptors: [new NumericExpressionDescriptor()] } },
      },
    ]);

    function printUsing(raw: string): string {
      const block: PslExtensionBlock = {
        kind: 'fixture-policy-select',
        keyword: 'policy_select',
        name: 'NumericPolicy',
        parameters: {
          target: refParam('Post'),
          using: valueParam(raw),
        },
        blockAttributes: [],
        attributes: {},
        span: STUB_SPAN,
      };
      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs([], [block])],
        span: STUB_SPAN,
      };
      return printPslFromAst(ast, {
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup: numericCodecLookup,
      });
    }

    it('renders the codec-encoded literal, dropping quotes the codec strips', () => {
      // raw captured as a quoted string; the codec decodes it to a number and
      // re-encodes to a bare number — so the printed literal is unquoted.
      const output = printUsing('"42"');
      expect(output).toContain('using = 42');
      expect(output).not.toContain('using = "42"');
    });

    it('renders a value whose JSON form is already canonical unchanged', () => {
      const output = printUsing('42');
      expect(output).toContain('using = 42');
    });

    it('throws when the value parameter references an unregistered codec', () => {
      const block: PslExtensionBlock = {
        kind: 'fixture-policy-select',
        keyword: 'policy_select',
        name: 'NumericPolicy',
        parameters: { target: refParam('Post'), using: valueParam('42') },
        blockAttributes: [],
        attributes: {},
        span: STUB_SPAN,
      };
      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs([], [block])],
        span: STUB_SPAN,
      };
      const emptyCodecLookup = extractCodecLookup([]);
      expect(() =>
        printPslFromAst(ast, {
          pslBlockDescriptors: assembled.pslBlockDescriptors,
          codecLookup: emptyCodecLookup,
        }),
      ).toThrow(FIXTURE_POLICY_CODEC_ID);
    });
  });

  // Output ordering is deterministic: the printer emits parameters in the
  // descriptor's declared order, not the order they happen to sit in the AST
  // node. Keeps printed/inferred output stable for fixtures:check and diffs.
  describe('parameter ordering follows the descriptor, not AST insertion order', () => {
    it('emits target, as, roles, using even when the node lists them reversed', () => {
      const block: PslExtensionBlock = {
        kind: 'fixture-policy-select',
        keyword: 'policy_select',
        name: 'ScrambledOrder',
        // Deliberately reversed relative to the descriptor's declared order.
        parameters: {
          using: valueParam('"true"'),
          roles: listParam([refParam('AdminRole')]),
          as: optionParam('permissive'),
          target: refParam('Post'),
        },
        blockAttributes: [],
        attributes: {},
        span: STUB_SPAN,
      };
      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs([], [block])],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(ast, {
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      const targetAt = output.indexOf('target = Post');
      const asAt = output.indexOf('as = permissive');
      const rolesAt = output.indexOf('roles = [AdminRole]');
      const usingAt = output.indexOf('using = "true"');
      expect(targetAt).toBeGreaterThan(-1);
      expect(targetAt).toBeLessThan(asAt);
      expect(asAt).toBeLessThan(rolesAt);
      expect(rolesAt).toBeLessThan(usingAt);
    });
  });

  describe('value parameter rendering edges', () => {
    function astWith(parameters: PslExtensionBlock['parameters']) {
      const block: PslExtensionBlock = {
        kind: 'fixture-policy-select',
        keyword: 'policy_select',
        name: 'EdgeCase',
        parameters,
        blockAttributes: [],
        attributes: {},
        span: STUB_SPAN,
      };
      return {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs([], [block])],
        span: STUB_SPAN,
      };
    }

    it('passes a value literal through verbatim when no codecLookup is supplied', () => {
      const output = printPslFromAst(
        astWith({ target: refParam('Post'), using: valueParam('"unverified"') }),
        { pslBlockDescriptors: assembled.pslBlockDescriptors },
      );
      expect(output).toContain('using = "unverified"');
    });

    it('throws when a value literal is not valid JSON', () => {
      expect(() =>
        printPslFromAst(astWith({ target: refParam('Post'), using: valueParam('not json {') }), {
          pslBlockDescriptors: assembled.pslBlockDescriptors,
          codecLookup,
        }),
      ).toThrow('not valid JSON');
    });

    it('reports an invalid value literal as CONTRACT.PACK_CONTRIBUTION_INVALID', () => {
      let thrown: unknown;
      try {
        printPslFromAst(astWith({ target: refParam('Post'), using: valueParam('not json {') }), {
          pslBlockDescriptors: assembled.pslBlockDescriptors,
          codecLookup,
        });
      } catch (error) {
        thrown = error;
      }
      expect(isStructuredError(thrown)).toBe(true);
      if (!isStructuredError(thrown)) {
        throw new Error('expected a structured error');
      }
      expect(thrown.code).toBe('CONTRACT.PACK_CONTRIBUTION_INVALID');
      expect(thrown.meta).toMatchObject({
        reason: 'raw-literal-invalid-json',
        paramName: 'using',
      });
    });

    it('throws when an AST parameter kind does not match its descriptor kind', () => {
      const cases: Array<{ params: PslExtensionBlock['parameters']; expected: string }> = [
        { params: { target: optionParam('Post'), using: valueParam('"x"') }, expected: 'ref' },
        { params: { target: refParam('Post'), using: refParam('x') }, expected: 'value' },
        {
          params: { target: refParam('Post'), as: refParam('x'), using: valueParam('"x"') },
          expected: 'option',
        },
        {
          params: { target: refParam('Post'), roles: refParam('x'), using: valueParam('"x"') },
          expected: 'list',
        },
      ];
      for (const { params, expected } of cases) {
        expect(() =>
          printPslFromAst(astWith(params), {
            pslBlockDescriptors: assembled.pslBlockDescriptors,
            codecLookup,
          }),
        ).toThrow(`descriptor is "${expected}"`);
      }
    });

    it('resolves descriptors registered under a nested namespace', () => {
      const nested = { authNs: assembled.pslBlockDescriptors };
      const output = printPslFromAst(
        astWith({ target: refParam('Post'), using: valueParam('"true"') }),
        { pslBlockDescriptors: nested, codecLookup },
      );
      expect(output).toContain('policy_select EdgeCase {');
      expect(output).toContain('target = Post');
    });
  });

  // Variadic blocks (descriptor `parameters: {}` + `variadicParameters: true`,
  // e.g. the Postgres `native_enum` block) carry their body as undeclared
  // parameter keys in AST insertion order, plus `@@` block attributes. Both
  // must render — a printer that walks only declared descriptor parameters
  // emits an empty block and silently drops `@@map`.
  describe('variadic block rendering (native_enum shape)', () => {
    const variadicDescriptors = {
      native_enum: {
        kind: 'pslBlock' as const,
        keyword: 'native_enum',
        discriminator: 'native_enum',
        name: { required: true },
        parameters: {},
        variadicParameters: true,
      },
    };

    it('renders variadic value parameters in insertion order with a @@ block attribute', () => {
      const block: PslExtensionBlock = {
        kind: 'native_enum',
        keyword: 'native_enum',
        name: 'AalLevel',
        parameters: {
          aal1: valueParam('"aal1"'),
          aal2: valueParam('"aal2"'),
          aal3: valueParam('"aal3"'),
        },
        blockAttributes: [
          {
            name: 'map',
            args: [{ kind: 'positional', value: '"aal_level"', span: STUB_SPAN }],
            span: STUB_SPAN,
          },
        ],
        attributes: {},
        span: STUB_SPAN,
      };

      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs([], [block])],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(ast, { pslBlockDescriptors: variadicDescriptors });

      expect(output).toContain(
        'native_enum AalLevel {\n  aal1 = "aal1"\n  aal2 = "aal2"\n  aal3 = "aal3"\n  @@map("aal_level")\n}',
      );
    });

    it('renders a variadic block without block attributes', () => {
      const block: PslExtensionBlock = {
        kind: 'native_enum',
        keyword: 'native_enum',
        name: 'Status',
        parameters: { draft: valueParam('"draft"'), done: valueParam('"done"') },
        blockAttributes: [],
        attributes: {},
        span: STUB_SPAN,
      };

      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs([], [block])],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(ast, { pslBlockDescriptors: variadicDescriptors });

      expect(output).toContain('native_enum Status {\n  draft = "draft"\n  done = "done"\n}');
      expect(output).not.toContain('@@');
    });

    it('renders a variadic member named like an Object.prototype key', () => {
      const block: PslExtensionBlock = {
        kind: 'native_enum',
        keyword: 'native_enum',
        name: 'Reserved',
        parameters: {
          toString: valueParam('"toString"'),
          constructor: valueParam('"constructor"'),
          plain: valueParam('"plain"'),
        },
        blockAttributes: [],
        attributes: {},
        span: STUB_SPAN,
      };

      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs([], [block])],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(ast, { pslBlockDescriptors: variadicDescriptors });

      expect(output).toContain('toString = "toString"');
      expect(output).toContain('constructor = "constructor"');
      expect(output).toContain('plain = "plain"');
    });

    it('renders each variadic value kind: value, ref, option, and a nested list', () => {
      const block: PslExtensionBlock = {
        kind: 'native_enum',
        keyword: 'native_enum',
        name: 'Mixed',
        parameters: {
          scalar: valueParam('"lit"'),
          reference: refParam('SomeRef'),
          choice: optionParam('permissive'),
          items: {
            kind: 'list',
            items: [valueParam('"a"'), valueParam('"b"'), refParam('Nested')],
            span: STUB_SPAN,
          },
        },
        blockAttributes: [],
        attributes: {},
        span: STUB_SPAN,
      };

      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs([], [block])],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(ast, { pslBlockDescriptors: variadicDescriptors });

      expect(output).toContain(
        'native_enum Mixed {\n' +
          '  scalar = "lit"\n' +
          '  reference = SomeRef\n' +
          '  choice = permissive\n' +
          '  items = ["a", "b", Nested]\n' +
          '}',
      );
    });

    it('renders block attributes with and without args', () => {
      const block: PslExtensionBlock = {
        kind: 'native_enum',
        keyword: 'native_enum',
        name: 'Attrs',
        parameters: { a: valueParam('"a"') },
        blockAttributes: [
          {
            name: 'map',
            args: [{ kind: 'positional', value: '"x"', span: STUB_SPAN }],
            span: STUB_SPAN,
          },
          { name: 'something', args: [], span: STUB_SPAN },
        ],
        attributes: {},
        span: STUB_SPAN,
      };

      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs([], [block])],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(ast, { pslBlockDescriptors: variadicDescriptors });

      expect(output).toContain('native_enum Attrs {\n  a = "a"\n  @@map("x")\n  @@something\n}');
    });

    it('renders a bare variadic member as its bare name, and a bare inside a list', () => {
      const block: PslExtensionBlock = {
        kind: 'native_enum',
        keyword: 'native_enum',
        name: 'Bares',
        parameters: {
          Low: { kind: 'bare', span: STUB_SPAN },
          nested: {
            kind: 'list',
            items: [valueParam('"a"'), { kind: 'bare', span: STUB_SPAN }],
            span: STUB_SPAN,
          },
        },
        blockAttributes: [],
        attributes: {},
        span: STUB_SPAN,
      };

      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs([], [block])],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(ast, { pslBlockDescriptors: variadicDescriptors });

      expect(output).toContain('native_enum Bares {\n  Low\n  nested = ["a", ]\n}');
    });

    it('skips a variadic param whose name is a declared descriptor parameter', () => {
      // `Object.hasOwn` guard: a variadic block whose descriptor also declares
      // parameters renders the declared one via the declared loop and must not
      // re-render it in the variadic loop.
      const mixedDescriptors = {
        native_enum: {
          kind: 'pslBlock' as const,
          keyword: 'native_enum',
          discriminator: 'native_enum',
          name: { required: true },
          parameters: { label: { kind: 'value' as const, codecId: 'unused' } },
          variadicParameters: true,
        },
      };
      const block: PslExtensionBlock = {
        kind: 'native_enum',
        keyword: 'native_enum',
        name: 'Mix',
        parameters: { label: valueParam('"declared"'), extra: valueParam('"variadic"') },
        blockAttributes: [],
        attributes: {},
        span: STUB_SPAN,
      };

      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs([], [block])],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(ast, { pslBlockDescriptors: mixedDescriptors });

      // `label` appears exactly once (declared loop), `extra` once (variadic loop).
      expect(output).toContain('native_enum Mix {\n  label = "declared"\n  extra = "variadic"\n}');
      expect(output.match(/label = "declared"/g)).toHaveLength(1);
    });
  });

  describe('block with unregistered keyword', () => {
    it('throws naming the unrecognised keyword', () => {
      const block: PslExtensionBlock = {
        kind: 'no-such-discriminator',
        keyword: 'no_such_keyword',
        name: 'OrphanBlock',
        parameters: {},
        blockAttributes: [],
        attributes: {},
        span: STUB_SPAN,
      };

      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs([], [block])],
        span: STUB_SPAN,
      };

      expect(() =>
        printPslFromAst(ast, {
          pslBlockDescriptors: assembled.pslBlockDescriptors,
          codecLookup,
        }),
      ).toThrow('no_such_keyword');
    });
  });

  describe('block whose keyword resolves to a descriptor owning a different discriminator', () => {
    const shapeDescriptors = {
      shape_circle: {
        kind: 'pslBlock' as const,
        keyword: 'shape_circle',
        discriminator: 'circle',
        name: { required: true },
        parameters: {},
      },
      shape_square: {
        kind: 'pslBlock' as const,
        keyword: 'shape_square',
        discriminator: 'square',
        name: { required: true },
        parameters: {},
      },
    };

    it('throws naming the keyword and the mismatched kind, not the unregistered-keyword message', () => {
      const block: PslExtensionBlock = {
        // The "shape_circle" keyword resolves to the descriptor that owns
        // discriminator "circle" — but this block carries kind "square",
        // which is registered too, just under a different descriptor.
        kind: 'square',
        keyword: 'shape_circle',
        name: 'Mismatched',
        parameters: {},
        blockAttributes: [],
        attributes: {},
        span: STUB_SPAN,
      };

      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs([], [block])],
        span: STUB_SPAN,
      };

      expect(() => printPslFromAst(ast, { pslBlockDescriptors: shapeDescriptors })).toThrow(
        /shape_circle.*circle.*square/s,
      );
    });
  });

  describe('N:1 — two keywords sharing one discriminator print back to their own keyword', () => {
    const shapeDescriptors = {
      shape_circle: {
        kind: 'pslBlock' as const,
        keyword: 'shape_circle',
        discriminator: 'shape',
        name: { required: true },
        parameters: {},
      },
      shape_square: {
        kind: 'pslBlock' as const,
        keyword: 'shape_square',
        discriminator: 'shape',
        name: { required: true },
        parameters: {},
      },
    };

    it('renders each block under its own keyword, not the other one sharing its kind', () => {
      const circle: PslExtensionBlock = {
        kind: 'shape',
        keyword: 'shape_circle',
        name: 'Round',
        parameters: {},
        blockAttributes: [],
        attributes: {},
        span: STUB_SPAN,
      };
      const square: PslExtensionBlock = {
        kind: 'shape',
        keyword: 'shape_square',
        name: 'Boxy',
        parameters: {},
        blockAttributes: [],
        attributes: {},
        span: STUB_SPAN,
      };

      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs([], [circle, square])],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(ast, { pslBlockDescriptors: shapeDescriptors });

      expect(output).toContain('shape_circle Round {');
      expect(output).toContain('shape_square Boxy {');
    });
  });

  describe('built-in print round-trip', () => {
    it('prints a model with @id field unchanged', () => {
      const models: PslModel[] = [
        {
          kind: 'model',
          name: 'Post',
          fields: [
            {
              kind: 'field',
              name: 'id',
              typeName: 'Int',
              optional: false,
              list: false,
              attributes: [
                {
                  kind: 'attribute',
                  target: 'field',
                  name: 'id',
                  args: [],
                  span: STUB_SPAN,
                },
              ],
              span: STUB_SPAN,
            },
          ],
          attributes: [],
          span: STUB_SPAN,
        },
      ];
      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [makeNs(models, [])],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(ast);
      expect(output).toContain('model Post {');
      expect(output).toContain('id Int @id');
    });
  });
});
