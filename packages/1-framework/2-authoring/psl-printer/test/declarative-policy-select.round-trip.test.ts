/**
 * Round-trip test for the declarative extension-block mechanism.
 *
 * Exercises the full pipeline for a declarative extension contribution:
 *
 *   text → parse → collect → spec-interpret (typed envelope) → lower via
 *   entityTypes factory → PolicySelectIr → serialize → hydrate → IR
 *   → print (source provenance) → re-parse → equivalent IR
 *
 * The fixture (`./fixtures/declarative-policy-select-extension.ts`)
 * contributes NO parser or printer code: parsing, value interpretation, and
 * printing are framework-owned. Lowering consumes only typed envelopes; the
 * printer consumes only source entries.
 */

import type { ParsedPslExtensionBlock } from '@internal/framework-components/authoring';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import {
  makePslNamespace,
  makePslNamespaceEntries,
  type PslDocumentAst,
  type PslExtensionBlock,
  type PslModel,
  type PslSpan,
  UNSPECIFIED_PSL_NAMESPACE_ID,
} from '@internal/framework-components/psl-ast';
import type { BlockSymbol, PslDiagnostic, SymbolTable } from '@internal/psl-parser';
import { buildSymbolTable, interpretExtensionBlocks } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';
import {
  declarativePolicySelectContributions,
  hydratePolicySelectIrFromJson,
  POLICY_SELECT_DISCRIMINATOR,
  POLICY_SELECT_KEYWORD,
  PolicySelectIr,
} from './fixtures/declarative-policy-select-extension';

const assembled = assembleAuthoringContributions([
  { authoring: declarativePolicySelectContributions },
]);

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

const ZERO_SPAN: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

interface ParsedPolicySelect {
  readonly symbolTable: SymbolTable;
  readonly diagnostics: readonly PslDiagnostic[];
  readonly parsedBlocks: ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock>;
  readonly blockSymbols: readonly BlockSymbol[];
}

function parsePolicySelect(schema: string): ParsedPolicySelect {
  const { document, sources } = parse(schema, 'declarative-policy-select.round-trip.test.psl');
  const { symbolTable, diagnostics: collectionDiagnostics } = buildSymbolTable({
    documents: [document],
    sources,
  });
  const { parsedBlocks, diagnostics: blockDiagnostics } = interpretExtensionBlocks(
    symbolTable,
    sources,
    assembled.pslBlockDescriptors,
  );
  const diagnostics = [...collectionDiagnostics, ...blockDiagnostics];
  const blockSymbols = Object.values(symbolTable.topLevel.blocks).filter(
    (block) => block.keyword === POLICY_SELECT_KEYWORD,
  );
  return { symbolTable, diagnostics, parsedBlocks, blockSymbols };
}

function onlyBlockSymbol(parsed: ParsedPolicySelect): BlockSymbol {
  if (parsed.blockSymbols.length !== 1) {
    throw new Error(`expected one policy_select block, got ${parsed.blockSymbols.length}`);
  }
  const block = parsed.blockSymbols[0];
  if (block === undefined) throw new Error('expected one policy_select block');
  return block;
}

function envelopeOf(parsed: ParsedPolicySelect, block: BlockSymbol): ParsedPslExtensionBlock {
  const envelope = parsed.parsedBlocks.get(block);
  if (envelope === undefined) throw new Error('expected a typed envelope for the block');
  return envelope;
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

describe('declarative policy_select round-trip (parse → collect → spec → lower → IR)', () => {
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

    it('publishes a typed envelope with the correct discriminator and decoded values', () => {
      const parsed = parsePolicySelect(source);
      const block = onlyBlockSymbol(parsed);
      expect(parsed.diagnostics).toEqual([]);
      const envelope = envelopeOf(parsed, block);
      expect(envelope).toMatchObject({
        kind: POLICY_SELECT_DISCRIMINATOR,
        name: 'ProfilesSelect',
      });
      expect(envelope?.values['using']).toBe('auth.uid() = author_id');
    });

    it('lowers the typed envelope to a PolicySelectIr via the entityTypes factory', () => {
      const parsed = parsePolicySelect(source);
      const block = onlyBlockSymbol(parsed);
      expect(parsed.diagnostics).toEqual([]);

      const factory = getFactory();
      const ir = factory(envelopeOf(parsed, block), { family: 'fixture', target: 'fixture' });

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

      const ir = getFactory()(envelopeOf(parsed, block), { family: 'fixture', target: 'fixture' });
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

    it('lowers the `as` token into the IR instance', () => {
      const parsed = parsePolicySelect(source);
      const block = onlyBlockSymbol(parsed);
      expect(parsed.diagnostics).toEqual([]);

      const ir = getFactory()(envelopeOf(parsed, block), { family: 'fixture', target: 'fixture' });
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

    it('surfaces the missing-required diagnostic and publishes no envelope', () => {
      const parsed = parsePolicySelect(source);
      const block = onlyBlockSymbol(parsed);
      expect(parsed.diagnostics).toEqual([
        expect.objectContaining({
          code: 'PSL_EXTENSION_MISSING_REQUIRED_PARAMETER',
          message: expect.stringContaining('using'),
        }),
      ]);
      expect(parsed.parsedBlocks.has(block)).toBe(false);
    });
  });

  describe('given a block with an unresolvable target ref', () => {
    const source = `policy_select OrphanPolicy {
  target = NonExistentModel
  using  = "true"
}
`;

    it('surfaces the parser reference diagnostic and publishes no envelope', () => {
      const parsed = parsePolicySelect(source);
      const block = onlyBlockSymbol(parsed);
      expect(parsed.diagnostics).toEqual([
        expect.objectContaining({
          message: 'Unknown model reference "NonExistentModel"',
        }),
      ]);
      expect(parsed.parsedBlocks.has(block)).toBe(false);
    });
  });

  describe('full round-trip: parse → spec → lower → IR → serialize → hydrate → print → re-parse', () => {
    const source = `model Post {
  id   Int    @id
  body String
}

policy_select ProfilesSelect {
  target = Post
  as     = restrictive
  using  = "auth.uid() = \\"author\\""
}
`;

    // The test is the producer here: the print shape's text is written from
    // the values the block means to carry, never rendered from parsed AST.
    function producedPolicyBlock(): PslExtensionBlock {
      return {
        kind: POLICY_SELECT_DISCRIMINATOR,
        keyword: POLICY_SELECT_KEYWORD,
        name: 'ProfilesSelect',
        parameters: {
          target: { expression: 'Post', span: ZERO_SPAN },
          as: { expression: 'restrictive', span: ZERO_SPAN },
          using: { expression: '"auth.uid() = \\"author\\""', span: ZERO_SPAN },
        },
        blockAttributes: [],
        span: ZERO_SPAN,
      };
    }

    it('prints the block back to PSL text containing the keyword and all entries', () => {
      const parsed = parsePolicySelect(source);
      expect(parsed.diagnostics).toEqual([]);

      const printed = printPslFromAst(
        documentForPrinting(parsed.symbolTable, producedPolicyBlock()),
        {
          pslBlockDescriptors: assembled.pslBlockDescriptors,
        },
      );

      expect(printed).toContain('policy_select ProfilesSelect {');
      expect(printed).toContain('target = Post');
      expect(printed).toContain('as = restrictive');
      expect(printed).toContain('using = "auth.uid() = \\"author\\""');
    });

    it('re-parses the printed PSL through the real pipeline into an equivalent IR', () => {
      const firstParsed = parsePolicySelect(source);
      const firstBlock = onlyBlockSymbol(firstParsed);
      expect(firstParsed.diagnostics).toEqual([]);

      const printed = printPslFromAst(
        documentForPrinting(firstParsed.symbolTable, producedPolicyBlock()),
        { pslBlockDescriptors: assembled.pslBlockDescriptors },
      );

      const reParsed = parsePolicySelect(printed);
      expect(reParsed.diagnostics).toEqual([]);
      const reParsedBlock = onlyBlockSymbol(reParsed);

      // Semantic equivalence: lower both typed envelopes to their IR and
      // compare. The IR is the contract-bound artifact, so identical IR after
      // print → re-parse is the round-trip guarantee that matters.
      const lower = getFactory();
      const originalIr = lower(envelopeOf(firstParsed, firstBlock), {
        family: 'fixture',
        target: 'fixture',
      });
      const reParsedIr = lower(envelopeOf(reParsed, reParsedBlock), {
        family: 'fixture',
        target: 'fixture',
      });
      expect(JSON.stringify(reParsedIr)).toBe(JSON.stringify(originalIr));
    });
  });
});
