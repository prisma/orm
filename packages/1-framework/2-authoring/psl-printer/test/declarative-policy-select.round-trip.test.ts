/**
 * Round-trip test for the declarative extension-block mechanism.
 *
 * Exercises the full pipeline for a declarative extension contribution:
 *
 *   text → parse → validate → lower via entityTypes factory → PolicySelectIr
 *        → serialize → hydrate → IR → print → re-parse → equivalent AST node
 *
 * The fixture (`./fixtures/declarative-policy-select-extension.ts`) contributes
 * NO parser or printer code. All parsing, validation, and printing is
 * framework-owned. The print legs (IR → PSL text → re-parse) confirm the
 * generic printer closes the loop.
 *
 * A stub codec for `fixture-policy/text@1` is registered for the duration of
 * these tests so the validator can accept double-quoted `using` literals and
 * the printer can round-trip them via the codec's JSON encode/decode.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  dataTypeId,
} from '@internal/framework-components/codec';
import {
  assembleAuthoringContributions,
  extractCodecLookup,
} from '@internal/framework-components/control';
import {
  makePslNamespace,
  makePslNamespaceEntries,
  type PslDocumentAst,
  type PslExtensionBlock,
  type PslModel,
  type PslSpan,
  UNSPECIFIED_PSL_NAMESPACE_ID,
} from '@internal/framework-components/psl-ast';
import {
  type BlockSymbol,
  buildSymbolTable,
  findBlockDescriptor,
  type SymbolTable,
  validateExtensionBlockFromSymbol,
} from '@internal/psl-parser';
import { type PslSources, parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';
import {
  declarativePolicySelectContributions,
  FIXTURE_POLICY_CODEC_ID,
  hydratePolicySelectIrFromJson,
  POLICY_SELECT_DISCRIMINATOR,
  POLICY_SELECT_KEYWORD,
  PolicySelectIr,
} from './fixtures/declarative-policy-select-extension';

// ---------------------------------------------------------------------------
// Stub codec — accepts any double-quoted string literal for the `using` param
// ---------------------------------------------------------------------------

class FixturePolicyTextCodec extends CodecImpl<
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

class FixturePolicyTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly dataType = dataTypeId('demo/fixture');
  override readonly codecId = FIXTURE_POLICY_CODEC_ID as typeof FIXTURE_POLICY_CODEC_ID;
  override readonly traits = ['textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => FixturePolicyTextCodec {
    return () => new FixturePolicyTextCodec(this);
  }
}

const fixtureCodecDescriptor = new FixturePolicyTextDescriptor();

const codecLookup = extractCodecLookup([
  {
    id: 'fixture-policy-ext',
    types: { codecTypes: { codecDescriptors: [fixtureCodecDescriptor] } },
  },
]);

const assembled = assembleAuthoringContributions([
  { authoring: declarativePolicySelectContributions },
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFactory() {
  const factoryEntry = assembled.entityTypes['policy_select'];
  if (factoryEntry === undefined || !('output' in factoryEntry)) {
    throw new Error('expected entityTypes.policy_select descriptor');
  }
  const output = factoryEntry.output;
  if (!('factory' in output) || typeof output.factory !== 'function') {
    throw new Error('expected entityTypes.policy_select.output.factory function');
  }
  return output.factory as (block: unknown, ctx: unknown) => PolicySelectIr;
}

const POLICY_SELECT_DESCRIPTOR = (() => {
  const descriptor = findBlockDescriptor(assembled.pslBlockDescriptors, POLICY_SELECT_KEYWORD);
  if (descriptor === undefined) throw new Error('expected a policy_select block descriptor');
  return descriptor;
})();

const ZERO_SPAN: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

interface ParsedPolicySelect {
  readonly symbolTable: SymbolTable;
  readonly sources: PslSources;
  readonly blockSymbols: readonly BlockSymbol[];
}

function parsePolicySelect(schema: string): ParsedPolicySelect {
  const { document, sources } = parse(schema, 'declarative-policy-select.round-trip.test.psl');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  const blockSymbols = Object.values(symbolTable.topLevel.blocks).filter(
    (block) => block.keyword === POLICY_SELECT_KEYWORD,
  );
  return { symbolTable, sources, blockSymbols };
}

function onlyBlockSymbol(parsed: ParsedPolicySelect): BlockSymbol {
  if (parsed.blockSymbols.length !== 1) {
    throw new Error(`expected one policy_select block, got ${parsed.blockSymbols.length}`);
  }
  const block = parsed.blockSymbols[0];
  if (block === undefined) throw new Error('expected one policy_select block');
  return block;
}

function reconstruct(_parsed: ParsedPolicySelect, block: BlockSymbol): PslExtensionBlock {
  return block.block;
}

function validate(parsed: ParsedPolicySelect, block: BlockSymbol) {
  return validateExtensionBlockFromSymbol({
    block,
    descriptor: POLICY_SELECT_DESCRIPTOR,
    symbolTable: parsed.symbolTable,
    sources: parsed.sources,
    codecLookup,
  });
}

function documentForPrinting(
  symbolTable: SymbolTable,
  extensionBlock: PslExtensionBlock,
): PslDocumentAst {
  const modelStubs: PslModel[] = Object.values(symbolTable.topLevel.models).map((model) => ({
    kind: 'model',
    name: model.name,
    fields: [],
    attributes: [],
    span: ZERO_SPAN,
  }));
  return {
    kind: 'document',
    sourceId: 'print',
    namespaces: [
      makePslNamespace({
        kind: 'namespace',
        name: UNSPECIFIED_PSL_NAMESPACE_ID,
        entries: makePslNamespaceEntries(modelStubs, [], [extensionBlock]),
        span: ZERO_SPAN,
      }),
    ],
    span: ZERO_SPAN,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('declarative policy_select round-trip (parse → validate → lower → IR)', () => {
  describe('given a PSL document with a policy_select block and a matching model', () => {
    const source = `model Post {
  id   Int    @id
  body String
}

policy_select ProfilesSelect {
  target = Post
  using  = "auth.uid() = author_id"
}
`;

    it('reconstructs the block into a uniform PslExtensionBlock with the correct discriminator', () => {
      const parsed = parsePolicySelect(source);
      const block = onlyBlockSymbol(parsed);
      expect(validate(parsed, block)).toEqual([]);
      const reconstructed = reconstruct(parsed, block);
      expect(reconstructed).toMatchObject({
        kind: POLICY_SELECT_DISCRIMINATOR,
        name: 'ProfilesSelect',
      });
    });

    it('validates the block and surfaces no diagnostics for a well-formed block', () => {
      const parsed = parsePolicySelect(source);
      const block = onlyBlockSymbol(parsed);
      expect(validate(parsed, block)).toEqual([]);
    });

    it('lowers the reconstructed block to a PolicySelectIr via the entityTypes factory', () => {
      const parsed = parsePolicySelect(source);
      const block = onlyBlockSymbol(parsed);
      expect(validate(parsed, block)).toEqual([]);

      const factory = getFactory();
      const ir = factory(reconstruct(parsed, block), { family: 'fixture', target: 'fixture' });

      expect(ir).toBeInstanceOf(PolicySelectIr);
      expect(Object.isFrozen(ir)).toBe(true);
      expect(ir).toMatchObject({
        kind: POLICY_SELECT_DISCRIMINATOR,
        name: 'ProfilesSelect',
        target: 'Post',
        using: 'auth.uid() = author_id',
      });
      expect(ir.as).toBeUndefined();
    });

    it('serializes and re-hydrates the IR instance without losing fields', () => {
      const parsed = parsePolicySelect(source);
      const block = onlyBlockSymbol(parsed);

      const ir = getFactory()(reconstruct(parsed, block), { family: 'fixture', target: 'fixture' });
      const serialized = JSON.stringify(ir);
      const hydrated = hydratePolicySelectIrFromJson(JSON.parse(serialized));

      expect(hydrated).toBeInstanceOf(PolicySelectIr);
      expect(Object.isFrozen(hydrated)).toBe(true);
      expect(JSON.stringify(hydrated)).toBe(serialized);
      expect({ ...hydrated }).toEqual({ ...ir });
    });
  });

  describe('given a block with the optional `as` parameter', () => {
    const source = `model Post {
  id Int @id
}

policy_select AdminRead {
  target = Post
  as     = permissive
  using  = "role = \\"admin\\""
}
`;

    it('lowers the `as` option into the IR instance', () => {
      const parsed = parsePolicySelect(source);
      const block = onlyBlockSymbol(parsed);
      expect(validate(parsed, block)).toEqual([]);

      const ir = getFactory()(reconstruct(parsed, block), { family: 'fixture', target: 'fixture' });
      expect(ir).toBeInstanceOf(PolicySelectIr);
      expect(ir.as).toBe('permissive');
      expect(ir.name).toBe('AdminRead');
      expect(ir.target).toBe('Post');
    });
  });

  describe('given a block with a missing required `using` parameter', () => {
    const source = `model Post {
  id Int @id
}

policy_select BadBlock {
  target = Post
}
`;

    it('surfaces a PSL_EXTENSION_MISSING_REQUIRED_PARAMETER diagnostic', () => {
      const parsed = parsePolicySelect(source);
      const block = onlyBlockSymbol(parsed);
      expect(validate(parsed, block)).toMatchObject([
        {
          code: 'PSL_EXTENSION_MISSING_REQUIRED_PARAMETER',
          message: expect.stringContaining('using'),
        },
      ]);
    });
  });

  describe('given a block with an unresolvable target ref', () => {
    const source = `policy_select OrphanPolicy {
  target = NonExistentModel
  using  = "true"
}
`;

    it('surfaces a PSL_EXTENSION_UNRESOLVED_REF diagnostic', () => {
      const parsed = parsePolicySelect(source);
      const block = onlyBlockSymbol(parsed);
      expect(validate(parsed, block)).toMatchObject([
        {
          code: 'PSL_EXTENSION_UNRESOLVED_REF',
          message: expect.stringContaining('NonExistentModel'),
        },
      ]);
    });
  });

  describe('given a block without a codecLookup in the parse call', () => {
    it('still reconstructs the block node, but codec validation rejects the value parameter', () => {
      const source = `model Post {
  id Int @id
}

policy_select NakedParse {
  target = Post
  using  = "auth.uid() = id"
}
`;
      const parsed = parsePolicySelect(source);
      const block = onlyBlockSymbol(parsed);

      expect(reconstruct(parsed, block)).toMatchObject({
        kind: POLICY_SELECT_DISCRIMINATOR,
        name: 'NakedParse',
      });

      const diagnostics = validateExtensionBlockFromSymbol({
        block,
        descriptor: POLICY_SELECT_DESCRIPTOR,
        symbolTable: parsed.symbolTable,
        sources: parsed.sources,
        codecLookup: extractCodecLookup([]),
      });
      expect(diagnostics[0]).toMatchObject({
        code: 'PSL_EXTENSION_INVALID_VALUE',
      });
    });
  });

  describe('full round-trip: parse → validate → lower → IR → serialize → hydrate → IR → print → re-parse', () => {
    const source = `model Post {
  id   Int    @id
  body String
}

policy_select ProfilesSelect {
  target = Post
  using  = "auth.uid() = author_id"
}
`;

    it('prints the block back to PSL text that contains the keyword and all parameters', () => {
      const parsed = parsePolicySelect(source);
      const block = onlyBlockSymbol(parsed);
      expect(validate(parsed, block)).toEqual([]);

      const printed = printPslFromAst(
        documentForPrinting(parsed.symbolTable, reconstruct(parsed, block)),
        { pslBlockDescriptors: assembled.pslBlockDescriptors, codecLookup },
      );

      expect(printed).toContain('policy_select ProfilesSelect {');
      expect(printed).toContain('target = Post');
      expect(printed).toContain('using = "auth.uid() = author_id"');
    });

    it('re-parses the printed PSL and produces an IR-equivalent extension block', () => {
      const firstParsed = parsePolicySelect(source);
      const firstBlock = onlyBlockSymbol(firstParsed);
      expect(validate(firstParsed, firstBlock)).toEqual([]);
      const original = reconstruct(firstParsed, firstBlock);

      const printed = printPslFromAst(documentForPrinting(firstParsed.symbolTable, original), {
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      const reParsed = parsePolicySelect(printed);
      const reParsedBlockSymbol = onlyBlockSymbol(reParsed);
      expect(validate(reParsed, reParsedBlockSymbol)).toEqual([]);
      const reParsedBlock = reconstruct(reParsed, reParsedBlockSymbol);

      // Semantic equivalence: lower both blocks to their IR and compare. The IR
      // is the contract-bound artifact, so identical IR after print → re-parse is
      // the round-trip guarantee that matters — the equivalent of the two
      // documents hashing the same, and stronger than matching a few AST fields.
      const lower = getFactory();
      const originalIr = lower(original, { family: 'fixture', target: 'fixture' });
      const reParsedIr = lower(reParsedBlock, { family: 'fixture', target: 'fixture' });
      expect(JSON.stringify(reParsedIr)).toBe(JSON.stringify(originalIr));
    });
  });
});
