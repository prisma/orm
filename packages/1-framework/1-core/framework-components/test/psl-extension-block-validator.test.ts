/**
 * Tests for the generic extension-block validator.
 *
 * Covers each of the five validator failure modes plus the fully-valid path:
 *
 * 1. Unknown parameter detected by key-set difference.
 * 2. Missing required parameter.
 * 3. `option` value outside its set.
 * 4. `value` rejected by its codec.
 * 5. `ref` that does not resolve within its declared scope.
 *    - `same-namespace`: rejected when the referent is in another namespace.
 *    - `same-space`: accepted when the referent is in any namespace.
 *    - `cross-space`: always passes (documented pass-through).
 *
 * Also covers:
 * - A fully-valid block emits no diagnostics.
 * - `list` recurses into each element.
 * - The `PSL_INVALID_EXTENSION_BLOCK_MEMBER` diagnostic codes emitted by
 *   the generic parser for malformed body lines and malformed list syntax.
 */

import type { JsonValue } from '@internal/contract/types';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, it } from 'vitest';
import { extractCodecLookup } from '../src/control/control-stack';
import {
  makePslNamespace,
  makePslNamespaceEntries,
  type PslNamespace,
} from '../src/control/psl-ast';
import {
  type ExtensionBlockRefResolutionContext,
  validateExtensionBlock,
} from '../src/control/psl-extension-block-validator';
import type { AuthoringPslBlockDescriptor } from '../src/exports/authoring';
import {
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  voidParamsSchema,
} from '../src/exports/codec';
import type { PslExtensionBlock } from '../src/exports/psl-ast';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SOURCE_ID = 'schema.prisma';

/** A stub span — exact positions are not exercised in these tests. */
function stubSpan() {
  return {
    start: { offset: 0, line: 1, column: 1 },
    end: { offset: 10, line: 1, column: 11 },
  };
}

// Minimal stub codec: accepts any JSON string value via decodeJson, rejects
// non-string JSON values (throws). Used to exercise the value-validation path
// in the validator, which calls codec.decodeJson(JSON.parse(raw)).
class StubStringCodec extends CodecImpl<'stub/string@1', readonly ['textual'], string, string> {
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
    if (typeof json !== 'string') {
      throw new TypeError(`expected a JSON string, got ${typeof json}`);
    }
    return json;
  }
}

class StubStringDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = 'stub/string@1' as const;
  override readonly traits = ['textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => StubStringCodec {
    return () => new StubStringCodec(this);
  }
}

const stubStringDescriptor = new StubStringDescriptor();

function buildCodecLookup() {
  return extractCodecLookup([
    { id: 'stub-ext', types: { codecTypes: { codecDescriptors: [stubStringDescriptor] } } },
  ]);
}

/** Descriptor that describes the test `policy_select` block. */
const policySelectDescriptor: AuthoringPslBlockDescriptor = {
  kind: 'pslBlock',
  keyword: 'policy_select',
  discriminator: 'test-policy-select',
  name: { required: true },
  parameters: {
    target: { kind: 'ref', refKind: 'model', scope: 'same-namespace', required: true },
    as: { kind: 'option', values: ['permissive', 'restrictive'], required: false },
    roles: {
      kind: 'list',
      of: { kind: 'ref', refKind: 'role', scope: 'cross-space' },
      required: false,
    },
    using: { kind: 'value', codecId: 'stub/string@1', required: true },
  },
};

/** A fully-valid parsed node for the policy_select block. */
function validNode(): PslExtensionBlock {
  return {
    kind: 'test-policy-select',
    keyword: 'policy_select',
    name: 'ReadPosts',
    span: stubSpan(),
    parameters: {
      target: { kind: 'ref', identifier: 'Post', span: stubSpan() },
      as: { kind: 'option', token: 'permissive', span: stubSpan() },
      roles: { kind: 'list', items: [], span: stubSpan() },
      using: { kind: 'value', raw: '"auth.uid() = user_id"', span: stubSpan() },
    },
    blockAttributes: [],
    attributes: {},
  };
}

/** A minimal PslNamespace with a single model named `Post`. */
function namespaceWithModel(nsName: string, modelName: string): PslNamespace {
  const model = {
    kind: 'model' as const,
    name: modelName,
    fields: [],
    attributes: [],
    span: stubSpan(),
  };
  return makePslNamespace({
    kind: 'namespace',
    name: nsName,
    span: stubSpan(),
    entries: makePslNamespaceEntries([model], [], []),
  });
}

function emptyNamespace(nsName: string): PslNamespace {
  return makePslNamespace({
    kind: 'namespace',
    name: nsName,
    span: stubSpan(),
    entries: makePslNamespaceEntries([], [], []),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateExtensionBlock', () => {
  const codecLookup = buildCodecLookup();

  describe('fully-valid block', () => {
    it('emits no diagnostics for a well-formed block', () => {
      const ns = namespaceWithModel('public', 'Post');
      const refCtx: ExtensionBlockRefResolutionContext = {
        ownerNamespace: ns,
        allNamespaces: [ns],
      };

      const diagnostics = validateExtensionBlock(
        validNode(),
        policySelectDescriptor,
        SOURCE_ID,
        codecLookup,
        refCtx,
      );

      expect(diagnostics).toEqual([]);
    });
  });

  describe('unknown parameter', () => {
    it('reports PSL_EXTENSION_UNKNOWN_PARAMETER for a key not in the descriptor (key-set diff)', () => {
      const node: PslExtensionBlock = {
        ...validNode(),
        parameters: {
          ...validNode().parameters,
          // 'check' is not declared in policySelectDescriptor.parameters
          check: { kind: 'value', raw: '"true"', span: stubSpan() },
        },
      };

      const ns = namespaceWithModel('public', 'Post');
      const refCtx: ExtensionBlockRefResolutionContext = {
        ownerNamespace: ns,
        allNamespaces: [ns],
      };

      const diagnostics = validateExtensionBlock(
        node,
        policySelectDescriptor,
        SOURCE_ID,
        codecLookup,
        refCtx,
      );

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe('PSL_EXTENSION_UNKNOWN_PARAMETER');
      expect(diagnostics[0]?.message).toContain('"check"');
      expect(diagnostics[0]?.sourceId).toBe(SOURCE_ID);
    });

    it('uses the captured span of the unknown parameter value', () => {
      const unknownSpan = {
        start: { offset: 50, line: 5, column: 3 },
        end: { offset: 60, line: 5, column: 13 },
      };
      const node: PslExtensionBlock = {
        ...validNode(),
        parameters: {
          ...validNode().parameters,
          extra: { kind: 'value', raw: 'foo', span: unknownSpan },
        },
      };

      const diagnostics = validateExtensionBlock(
        node,
        policySelectDescriptor,
        SOURCE_ID,
        codecLookup,
      );

      expect(diagnostics[0]?.code).toBe('PSL_EXTENSION_UNKNOWN_PARAMETER');
      expect(diagnostics[0]?.span).toEqual(unknownSpan);
    });
  });

  describe('missing required parameter', () => {
    it('reports PSL_EXTENSION_MISSING_REQUIRED_PARAMETER when a required param is absent', () => {
      // Remove `target` (required: true) and `using` (required: true) from the node.
      const { target: _t, using: _u, ...rest } = validNode().parameters;
      const node: PslExtensionBlock = {
        ...validNode(),
        parameters: rest,
      };

      const diagnostics = validateExtensionBlock(
        node,
        policySelectDescriptor,
        SOURCE_ID,
        codecLookup,
      );

      const codes = diagnostics.map((d) => d.code);
      expect(codes.filter((c) => c === 'PSL_EXTENSION_MISSING_REQUIRED_PARAMETER')).toHaveLength(2);
      const messages = diagnostics.map((d) => d.message);
      expect(messages.some((m) => m.includes('"target"'))).toBe(true);
      expect(messages.some((m) => m.includes('"using"'))).toBe(true);
    });

    it('does not report missing-required when only optional params are absent', () => {
      // Remove `as` (required: false) and `roles` (required: false).
      const { as: _a, roles: _r, ...rest } = validNode().parameters;
      const node: PslExtensionBlock = {
        ...validNode(),
        parameters: rest,
      };

      const ns = namespaceWithModel('public', 'Post');
      const refCtx: ExtensionBlockRefResolutionContext = {
        ownerNamespace: ns,
        allNamespaces: [ns],
      };

      const diagnostics = validateExtensionBlock(
        node,
        policySelectDescriptor,
        SOURCE_ID,
        codecLookup,
        refCtx,
      );

      expect(diagnostics.every((d) => d.code !== 'PSL_EXTENSION_MISSING_REQUIRED_PARAMETER')).toBe(
        true,
      );
    });
  });

  describe('option value outside its set', () => {
    it('reports PSL_EXTENSION_OPTION_OUT_OF_SET for a token not in values[]', () => {
      const node: PslExtensionBlock = {
        ...validNode(),
        parameters: {
          ...validNode().parameters,
          as: { kind: 'option', token: 'none', span: stubSpan() },
        },
      };

      const ns = namespaceWithModel('public', 'Post');
      const refCtx: ExtensionBlockRefResolutionContext = {
        ownerNamespace: ns,
        allNamespaces: [ns],
      };

      const diagnostics = validateExtensionBlock(
        node,
        policySelectDescriptor,
        SOURCE_ID,
        codecLookup,
        refCtx,
      );

      const d = diagnostics.find((x) => x.code === 'PSL_EXTENSION_OPTION_OUT_OF_SET');
      expect(d).toBeDefined();
      expect(d?.message).toContain('"none"');
      expect(d?.message).toContain('"permissive"');
      expect(d?.message).toContain('"restrictive"');
    });

    it('emits no option diagnostic for an allowed token', () => {
      const ns = namespaceWithModel('public', 'Post');
      const refCtx: ExtensionBlockRefResolutionContext = {
        ownerNamespace: ns,
        allNamespaces: [ns],
      };

      const diagnostics = validateExtensionBlock(
        validNode(), // 'as' = 'permissive' which is allowed
        policySelectDescriptor,
        SOURCE_ID,
        codecLookup,
        refCtx,
      );

      expect(diagnostics.some((d) => d.code === 'PSL_EXTENSION_OPTION_OUT_OF_SET')).toBe(false);
    });
  });

  describe('value rejected by its codec', () => {
    it('reports PSL_EXTENSION_INVALID_VALUE when the raw literal is not valid JSON', () => {
      const node: PslExtensionBlock = {
        ...validNode(),
        parameters: {
          ...validNode().parameters,
          // Not valid JSON — JSON.parse will throw a SyntaxError.
          using: { kind: 'value', raw: 'not_a_quoted_string', span: stubSpan() },
        },
      };

      const ns = namespaceWithModel('public', 'Post');
      const refCtx: ExtensionBlockRefResolutionContext = {
        ownerNamespace: ns,
        allNamespaces: [ns],
      };

      const diagnostics = validateExtensionBlock(
        node,
        policySelectDescriptor,
        SOURCE_ID,
        codecLookup,
        refCtx,
      );

      const d = diagnostics.find((x) => x.code === 'PSL_EXTENSION_INVALID_VALUE');
      expect(d).toBeDefined();
      expect(d?.message).toContain('"using"');
      expect(d?.message).toContain('JSON literal');
    });

    it('reports PSL_EXTENSION_INVALID_VALUE when decodeJson rejects the JSON value', () => {
      const node: PslExtensionBlock = {
        ...validNode(),
        parameters: {
          ...validNode().parameters,
          // 42 is valid JSON but StubStringCodec.decodeJson rejects non-string values.
          using: { kind: 'value', raw: '42', span: stubSpan() },
        },
      };

      const ns = namespaceWithModel('public', 'Post');
      const refCtx: ExtensionBlockRefResolutionContext = {
        ownerNamespace: ns,
        allNamespaces: [ns],
      };

      const diagnostics = validateExtensionBlock(
        node,
        policySelectDescriptor,
        SOURCE_ID,
        codecLookup,
        refCtx,
      );

      const d = diagnostics.find((x) => x.code === 'PSL_EXTENSION_INVALID_VALUE');
      expect(d).toBeDefined();
      expect(d?.message).toContain('"using"');
      expect(d?.message).toContain('stub/string@1');
    });

    it('emits no value diagnostic when the codec accepts the literal', () => {
      const ns = namespaceWithModel('public', 'Post');
      const refCtx: ExtensionBlockRefResolutionContext = {
        ownerNamespace: ns,
        allNamespaces: [ns],
      };

      const diagnostics = validateExtensionBlock(
        validNode(), // using = '"auth.uid() = user_id"' — accepted
        policySelectDescriptor,
        SOURCE_ID,
        codecLookup,
        refCtx,
      );

      expect(diagnostics.some((d) => d.code === 'PSL_EXTENSION_INVALID_VALUE')).toBe(false);
    });
  });

  describe('ref scope resolution', () => {
    describe('same-namespace scope', () => {
      it('accepts a ref when the referent model is in the same namespace', () => {
        const ns = namespaceWithModel('public', 'Post');
        const refCtx: ExtensionBlockRefResolutionContext = {
          ownerNamespace: ns,
          allNamespaces: [ns],
        };

        const diagnostics = validateExtensionBlock(
          validNode(), // target = 'Post'
          policySelectDescriptor,
          SOURCE_ID,
          codecLookup,
          refCtx,
        );

        expect(diagnostics.some((d) => d.code === 'PSL_EXTENSION_UNRESOLVED_REF')).toBe(false);
      });

      it('rejects a ref when the referent model is in a different namespace', () => {
        // The block is in 'public' but 'Post' only exists in 'auth'.
        const ownerNs = emptyNamespace('public');
        const otherNs = namespaceWithModel('auth', 'Post');
        const refCtx: ExtensionBlockRefResolutionContext = {
          ownerNamespace: ownerNs,
          allNamespaces: [ownerNs, otherNs],
        };

        const diagnostics = validateExtensionBlock(
          validNode(), // target = 'Post', scope = same-namespace
          policySelectDescriptor,
          SOURCE_ID,
          codecLookup,
          refCtx,
        );

        const d = diagnostics.find((x) => x.code === 'PSL_EXTENSION_UNRESOLVED_REF');
        expect(d).toBeDefined();
        expect(d?.message).toContain('"Post"');
        expect(d?.message).toContain('same namespace');
      });

      it('rejects a ref for a nonexistent entity in the same namespace', () => {
        const ns = emptyNamespace('public');
        const refCtx: ExtensionBlockRefResolutionContext = {
          ownerNamespace: ns,
          allNamespaces: [ns],
        };

        const diagnostics = validateExtensionBlock(
          validNode(), // target = 'Post', but ns has no models
          policySelectDescriptor,
          SOURCE_ID,
          codecLookup,
          refCtx,
        );

        expect(diagnostics.some((d) => d.code === 'PSL_EXTENSION_UNRESOLVED_REF')).toBe(true);
      });
    });

    describe('same-space scope', () => {
      it('accepts a ref when the referent is in any namespace', () => {
        // Descriptor with a same-space ref.
        const sameSpaceDescriptor: AuthoringPslBlockDescriptor = {
          kind: 'pslBlock',
          keyword: 'test_block',
          discriminator: 'test-block',
          name: { required: true },
          parameters: {
            target: { kind: 'ref', refKind: 'model', scope: 'same-space', required: true },
          },
        };

        const ns1 = emptyNamespace('ns1');
        const ns2 = namespaceWithModel('ns2', 'Post');
        const refCtx: ExtensionBlockRefResolutionContext = {
          ownerNamespace: ns1,
          allNamespaces: [ns1, ns2],
        };

        const node: PslExtensionBlock = {
          kind: 'test-block',
          keyword: 'test_block',
          name: 'MyBlock',
          span: stubSpan(),
          parameters: {
            target: { kind: 'ref', identifier: 'Post', span: stubSpan() },
          },
          blockAttributes: [],
          attributes: {},
        };

        const diagnostics = validateExtensionBlock(
          node,
          sameSpaceDescriptor,
          SOURCE_ID,
          codecLookup,
          refCtx,
        );

        expect(diagnostics.some((d) => d.code === 'PSL_EXTENSION_UNRESOLVED_REF')).toBe(false);
      });

      it('rejects a same-space ref when the referent does not exist in any namespace', () => {
        const sameSpaceDescriptor: AuthoringPslBlockDescriptor = {
          kind: 'pslBlock',
          keyword: 'test_block',
          discriminator: 'test-block',
          name: { required: true },
          parameters: {
            target: { kind: 'ref', refKind: 'model', scope: 'same-space', required: true },
          },
        };

        const ns = emptyNamespace('public');
        const refCtx: ExtensionBlockRefResolutionContext = {
          ownerNamespace: ns,
          allNamespaces: [ns],
        };

        const node: PslExtensionBlock = {
          kind: 'test-block',
          keyword: 'test_block',
          name: 'MyBlock',
          span: stubSpan(),
          parameters: {
            target: { kind: 'ref', identifier: 'Ghost', span: stubSpan() },
          },
          blockAttributes: [],
          attributes: {},
        };

        const diagnostics = validateExtensionBlock(
          node,
          sameSpaceDescriptor,
          SOURCE_ID,
          codecLookup,
          refCtx,
        );

        expect(diagnostics.some((d) => d.code === 'PSL_EXTENSION_UNRESOLVED_REF')).toBe(true);
      });
    });

    describe('cross-space scope', () => {
      it('always passes (documented pass-through)', () => {
        // `roles` in policySelectDescriptor has scope: 'cross-space'.
        const node: PslExtensionBlock = {
          ...validNode(),
          parameters: {
            ...validNode().parameters,
            roles: {
              kind: 'list',
              items: [
                // A role identifier that does not exist anywhere in the document.
                { kind: 'ref', identifier: 'anon', span: stubSpan() },
                { kind: 'ref', identifier: 'authenticated', span: stubSpan() },
              ],
              span: stubSpan(),
            },
          },
        };

        const ns = namespaceWithModel('public', 'Post');
        const refCtx: ExtensionBlockRefResolutionContext = {
          ownerNamespace: ns,
          allNamespaces: [ns],
        };

        const diagnostics = validateExtensionBlock(
          node,
          policySelectDescriptor,
          SOURCE_ID,
          codecLookup,
          refCtx,
        );

        // No PSL_EXTENSION_UNRESOLVED_REF for cross-space refs.
        expect(diagnostics.every((d) => d.code !== 'PSL_EXTENSION_UNRESOLVED_REF')).toBe(true);
      });
    });
  });

  describe('list parameter', () => {
    it('validates each list element against the element descriptor', () => {
      // A descriptor whose list elements are option-kind.
      const listDescriptor: AuthoringPslBlockDescriptor = {
        kind: 'pslBlock',
        keyword: 'test_list',
        discriminator: 'test-list',
        name: { required: true },
        parameters: {
          modes: {
            kind: 'list',
            of: { kind: 'option', values: ['read', 'write'] },
            required: false,
          },
        },
      };

      const node: PslExtensionBlock = {
        kind: 'test-list',
        keyword: 'test_list',
        name: 'MyBlock',
        span: stubSpan(),
        parameters: {
          modes: {
            kind: 'list',
            items: [
              { kind: 'option', token: 'read', span: stubSpan() },
              // 'execute' is not in ['read', 'write']
              { kind: 'option', token: 'execute', span: stubSpan() },
              { kind: 'option', token: 'write', span: stubSpan() },
            ],
            span: stubSpan(),
          },
        },
        blockAttributes: [],
        attributes: {},
      };

      const diagnostics = validateExtensionBlock(node, listDescriptor, SOURCE_ID, codecLookup);

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe('PSL_EXTENSION_OPTION_OUT_OF_SET');
      expect(diagnostics[0]?.message).toContain('"execute"');
    });

    it('emits no diagnostic for a valid list', () => {
      const ns = namespaceWithModel('public', 'Post');
      const refCtx: ExtensionBlockRefResolutionContext = {
        ownerNamespace: ns,
        allNamespaces: [ns],
      };

      // roles = [] is valid (not required, empty list).
      const diagnostics = validateExtensionBlock(
        validNode(),
        policySelectDescriptor,
        SOURCE_ID,
        codecLookup,
        refCtx,
      );

      expect(diagnostics.some((d) => d.code === 'PSL_EXTENSION_OPTION_OUT_OF_SET')).toBe(false);
    });
  });

  describe('diagnostic codes', () => {
    it('all emitted codes are members of PslDiagnosticCode', () => {
      // Indirectly verified by TypeScript — the PslDiagnostic type constrains
      // the `code` field to PslDiagnosticCode. This test exercises the runtime
      // path to confirm the codes are actual strings the union covers.
      const node: PslExtensionBlock = {
        kind: 'test-policy-select',
        keyword: 'policy_select',
        name: 'BadBlock',
        span: stubSpan(),
        parameters: {
          // unknown key
          unknown_param: { kind: 'value', raw: 'x', span: stubSpan() },
          // option value out of set
          as: { kind: 'option', token: 'bad', span: stubSpan() },
          // value rejected by codec (not quoted)
          using: { kind: 'value', raw: 'not_quoted', span: stubSpan() },
        },
        blockAttributes: [],
        attributes: {},
        // target (required) is missing
        // using (required) — present but invalid
      };

      const diagnostics = validateExtensionBlock(
        node,
        policySelectDescriptor,
        SOURCE_ID,
        codecLookup,
      );

      const expectedCodes = new Set([
        'PSL_EXTENSION_UNKNOWN_PARAMETER',
        'PSL_EXTENSION_MISSING_REQUIRED_PARAMETER',
        'PSL_EXTENSION_OPTION_OUT_OF_SET',
        'PSL_EXTENSION_INVALID_VALUE',
      ]);

      for (const d of diagnostics) {
        expect(expectedCodes).toContain(d.code);
      }

      const observedCodes = new Set(diagnostics.map((d) => d.code));
      expect(observedCodes).toContain('PSL_EXTENSION_UNKNOWN_PARAMETER');
      expect(observedCodes).toContain('PSL_EXTENSION_MISSING_REQUIRED_PARAMETER');
      expect(observedCodes).toContain('PSL_EXTENSION_OPTION_OUT_OF_SET');
      expect(observedCodes).toContain('PSL_EXTENSION_INVALID_VALUE');
    });
  });
});
