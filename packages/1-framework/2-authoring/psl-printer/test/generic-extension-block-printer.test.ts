/**
 * Tests for the generic framework printer for extension-contributed PSL
 * blocks. The printer renders each block's ordered print entries and
 * printable `@@` attribute lines verbatim — provenance rendering, no value
 * interpretation. Registration and keyword/discriminator consistency checks
 * are the printer's whole use of the descriptor: spec factories are never
 * executed.
 */

import { assembleAuthoringContributions } from '@internal/framework-components/control';
import type {
  PslExtensionBlock,
  PslExtensionBlockPrintEntry,
  PslModel,
} from '@internal/framework-components/psl-ast';
import {
  makePslNamespace,
  makePslNamespaceEntries,
  UNSPECIFIED_PSL_NAMESPACE_ID,
} from '@internal/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';
import { declarativePolicySelectContributions } from './fixtures/declarative-policy-select-extension';

const assembled = assembleAuthoringContributions([
  { authoring: declarativePolicySelectContributions },
]);

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

function entry(expression: string): PslExtensionBlockPrintEntry {
  return { expression, span: STUB_SPAN };
}

function bareEntry(): PslExtensionBlockPrintEntry {
  return { span: STUB_SPAN };
}

function astWithBlocks(blocks: PslExtensionBlock[]) {
  return {
    kind: 'document' as const,
    sourceId: 'test',
    namespaces: [makeNs([], blocks)],
    span: STUB_SPAN,
  };
}

/**
 * Descriptors for printer-only fixtures: the spec factory THROWS, pinning
 * that provenance rendering never executes spec factories.
 */
function printOnlyDescriptor(keyword: string, discriminator: string) {
  return {
    kind: 'pslBlock' as const,
    keyword,
    discriminator,
    name: { required: true as const },
    spec: () => {
      throw new Error(`printer must not execute the "${keyword}" spec factory`);
    },
  };
}

describe('generic extension-block printer', () => {
  describe('source-entry rendering', () => {
    it('renders entries in authored order with their expression text verbatim', () => {
      const block: PslExtensionBlock = {
        kind: 'fixture-policy-select',
        keyword: 'policy_select',
        name: 'ProfilesSelect',
        parameters: {
          target: entry('Post'),
          as: entry('permissive'),
          roles: entry('[AdminRole, EditorRole]'),
          using: entry('"auth.uid() = author_id"'),
        },
        blockAttributes: [],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(astWithBlocks([block]), {
        pslBlockDescriptors: assembled.pslBlockDescriptors,
      });

      expect(output).toContain(
        'policy_select ProfilesSelect {\n' +
          '  target = Post\n' +
          '  as = permissive\n' +
          '  roles = [AdminRole, EditorRole]\n' +
          '  using = "auth.uid() = author_id"\n' +
          '}',
      );
    });

    it('preserves authored order rather than restoring the retired descriptor order', () => {
      // The retired descriptor-driven renderer reordered entries into the
      // descriptor's declared order; provenance rendering keeps the authored
      // order. This pins the deliberate old-vs-new difference.
      const block: PslExtensionBlock = {
        kind: 'fixture-policy-select',
        keyword: 'policy_select',
        name: 'ScrambledOrder',
        parameters: {
          using: entry('"true"'),
          roles: entry('[AdminRole]'),
          as: entry('permissive'),
          target: entry('Post'),
        },
        blockAttributes: [],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(astWithBlocks([block]), {
        pslBlockDescriptors: assembled.pslBlockDescriptors,
      });

      expect(output).toContain(
        'policy_select ScrambledOrder {\n' +
          '  using = "true"\n' +
          '  roles = [AdminRole]\n' +
          '  as = permissive\n' +
          '  target = Post\n' +
          '}',
      );
    });

    it('renders escaped string literals exactly as their source text', () => {
      const block: PslExtensionBlock = {
        kind: 'fixture-policy-select',
        keyword: 'policy_select',
        name: 'Escaped',
        parameters: {
          target: entry('Post'),
          using: entry('"name = \\"O\'Hara\\"\\nline"'),
        },
        blockAttributes: [],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(astWithBlocks([block]), {
        pslBlockDescriptors: assembled.pslBlockDescriptors,
      });

      expect(output).toContain('  using = "name = \\"O\'Hara\\"\\nline"');
    });

    it('renders a bare entry as its key alone', () => {
      const block: PslExtensionBlock = {
        kind: 'print-enum',
        keyword: 'print_enum',
        name: 'Bares',
        parameters: {
          Low: bareEntry(),
          High: entry('"high"'),
        },
        blockAttributes: [],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(astWithBlocks([block]), {
        pslBlockDescriptors: { print_enum: printOnlyDescriptor('print_enum', 'print-enum') },
      });

      expect(output).toContain('print_enum Bares {\n  Low\n  High = "high"\n}');
    });

    it('renders entries named like Object.prototype keys', () => {
      const parameters: Record<string, PslExtensionBlockPrintEntry> = Object.create(null);
      parameters['toString'] = entry('"toString"');
      parameters['constructor'] = entry('"constructor"');
      parameters['plain'] = entry('"plain"');
      const block: PslExtensionBlock = {
        kind: 'print-enum',
        keyword: 'print_enum',
        name: 'Reserved',
        parameters,
        blockAttributes: [],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(astWithBlocks([block]), {
        pslBlockDescriptors: { print_enum: printOnlyDescriptor('print_enum', 'print-enum') },
      });

      expect(output).toContain('toString = "toString"');
      expect(output).toContain('constructor = "constructor"');
      expect(output).toContain('plain = "plain"');
    });
  });

  describe('block attribute rendering', () => {
    it('renders block attributes with and without args after the entries', () => {
      const block: PslExtensionBlock = {
        kind: 'print-enum',
        keyword: 'print_enum',
        name: 'Attrs',
        parameters: { a: entry('"a"') },
        blockAttributes: [
          {
            name: 'map',
            args: [{ kind: 'positional', value: '"x"', span: STUB_SPAN }],
            span: STUB_SPAN,
          },
          { name: 'something', args: [], span: STUB_SPAN },
        ],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(astWithBlocks([block]), {
        pslBlockDescriptors: { print_enum: printOnlyDescriptor('print_enum', 'print-enum') },
      });

      expect(output).toContain('print_enum Attrs {\n  a = "a"\n  @@map("x")\n  @@something\n}');
    });
  });

  describe('registration checks stay', () => {
    it('throws naming the unrecognised keyword', () => {
      const block: PslExtensionBlock = {
        kind: 'no-such-discriminator',
        keyword: 'no_such_keyword',
        name: 'OrphanBlock',
        parameters: {},
        blockAttributes: [],
        span: STUB_SPAN,
      };

      expect(() =>
        printPslFromAst(astWithBlocks([block]), {
          pslBlockDescriptors: assembled.pslBlockDescriptors,
        }),
      ).toThrow('no_such_keyword');
    });

    it('throws naming the keyword and the mismatched kind', () => {
      const block: PslExtensionBlock = {
        kind: 'square',
        keyword: 'shape_circle',
        name: 'Mismatched',
        parameters: {},
        blockAttributes: [],
        span: STUB_SPAN,
      };

      expect(() =>
        printPslFromAst(astWithBlocks([block]), {
          pslBlockDescriptors: {
            shape_circle: printOnlyDescriptor('shape_circle', 'circle'),
            shape_square: printOnlyDescriptor('shape_square', 'square'),
          },
        }),
      ).toThrow(/shape_circle.*circle.*square/s);
    });

    it('resolves descriptors registered under a nested namespace', () => {
      const block: PslExtensionBlock = {
        kind: 'fixture-policy-select',
        keyword: 'policy_select',
        name: 'Nested',
        parameters: { target: entry('Post'), using: entry('"true"') },
        blockAttributes: [],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(astWithBlocks([block]), {
        pslBlockDescriptors: { authNs: assembled.pslBlockDescriptors },
      });

      expect(output).toContain('policy_select Nested {');
      expect(output).toContain('target = Post');
    });
  });

  describe('N:1 — two keywords sharing one discriminator print back to their own keyword', () => {
    it('renders each block under its own keyword, not the other one sharing its kind', () => {
      const circle: PslExtensionBlock = {
        kind: 'shape',
        keyword: 'shape_circle',
        name: 'Round',
        parameters: {},
        blockAttributes: [],
        span: STUB_SPAN,
      };
      const square: PslExtensionBlock = {
        kind: 'shape',
        keyword: 'shape_square',
        name: 'Boxy',
        parameters: {},
        blockAttributes: [],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(astWithBlocks([circle, square]), {
        pslBlockDescriptors: {
          shape_circle: printOnlyDescriptor('shape_circle', 'shape'),
          shape_square: printOnlyDescriptor('shape_square', 'shape'),
        },
      });

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
