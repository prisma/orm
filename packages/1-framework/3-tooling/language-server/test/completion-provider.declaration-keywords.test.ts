import { describe, expect, it } from 'vitest';
import { type CompletionItem, CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import {
  auditAttribute,
  complete,
  completeWithSource,
  completionItemByLabel,
  nameSnippetPlaceholder,
  policySpec,
} from './helpers/completion-provider';

describe('providePslCompletionItems', () => {
  it('returns document-level declaration keyword candidates with stable plain-text edits', () => {
    const { items, sourceFile, cursorOffset } = complete('|');

    expect(items.map((item) => item.label)).toEqual([
      'model',
      'model mixin',
      'type',
      'type mixin',
      'types',
      'namespace',
      'audit',
      'audit mixin',
      'inventory',
      'inventory mixin',
      'policy',
      'policy mixin',
    ]);
    expect(items.map((item) => item.detail)).toEqual([
      'Defines a data model.',
      'Declares a mixin for model blocks.',
      'Defines a reusable composite type.',
      'Declares a mixin for type blocks.',
      'Defines reusable type aliases.',
      'Groups declarations belonging to the same database schema or database.',
      'Generic block keyword',
      'Declares a mixin for audit blocks.',
      'An arbitrary-key block.',
      'Declares a mixin for inventory blocks.',
      'Defines a security policy.',
      'Declares a mixin for policy blocks.',
    ]);
    expect(items[0]).toMatchObject({
      kind: CompletionItemKind.Keyword,
      filterText: 'model',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'model ',
      },
    });
    expect(items[0]?.insertTextFormat).toBeUndefined();
  });

  it('returns the full document-level declaration keyword set with a replace range over the typed segment', () => {
    const { items, sourceFile, cursorOffset } = complete('mo|');

    expect(items.map((item) => item.label)).toEqual([
      'model',
      'model mixin',
      'type',
      'type mixin',
      'types',
      'namespace',
      'audit',
      'audit mixin',
      'inventory',
      'inventory mixin',
      'policy',
      'policy mixin',
    ]);
    expect(items[0]).toMatchObject({
      filterText: 'model',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'mo'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'model ',
      },
    });
  });

  it('returns namespace-body declaration keywords without document-only native keywords', () => {
    const { items } = complete(['namespace feature {', '  |', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual([
      'model',
      'model mixin',
      'type',
      'type mixin',
      'audit',
      'audit mixin',
      'inventory',
      'inventory mixin',
      'policy',
      'policy mixin',
    ]);
    expect(items.map((item) => item.label)).not.toContain('types');
    expect(items.map((item) => item.label)).not.toContain('namespace');
  });

  it('returns the full namespace-body declaration keyword set with a replace range over the typed segment', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['namespace feature {', '  po|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual([
      'model',
      'model mixin',
      'type',
      'type mixin',
      'audit',
      'audit mixin',
      'inventory',
      'inventory mixin',
      'policy',
      'policy mixin',
    ]);
    expect(items.find((item) => item.label === 'policy')).toMatchObject({
      filterText: 'policy',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'po'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'policy ',
      },
    });
  });

  it('returns snippet declaration keyword edits only when the client supports snippets', () => {
    const { items } = complete('|', { clientSupportsSnippets: true });

    expect(items.find((item) => item.label === 'model')).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `model ${nameSnippetPlaceholder} {\n  \${0:// Fields}\n}` },
    });
    expect(items.find((item) => item.label === 'policy')).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: {
        newText: `policy ${nameSnippetPlaceholder} {\n  \${0:// Block keys and attributes}\n}`,
      },
    });
  });

  it.each([true, false])(
    'inserts a body placeholder without pre-filled keys, snippets=%s',
    (snippets) => {
      const { items } = completeWithSource({
        markedSource: '|',
        clientSupportsSnippets: snippets,
        pslBlockDescriptors: {
          security: {
            policy: {
              kind: 'pslBlock',
              keyword: 'policy',
              discriminator: 'policy',
              name: { required: true },
              spec: policySpec,
              attributes: { audit: () => auditAttribute },
            },
          },
        },
      });
      const item = completionItemByLabel(items, 'policy');
      expect(item.textEdit?.newText).toBe(
        snippets
          ? [
              `policy ${nameSnippetPlaceholder} {`,
              '  $' + '{0:// Block keys and attributes}',
              '}',
            ].join('\n')
          : 'policy ',
      );
      expect(item.insertTextFormat).toBe(snippets ? InsertTextFormat.Snippet : undefined);
    },
  );

  describe('mixin declaration items', () => {
    const sortedLabels = (items: readonly CompletionItem[]) =>
      [...items]
        .sort((left, right) => ((left.sortText ?? '') < (right.sortText ?? '') ? -1 : 1))
        .map((item) => item.label);

    it('offers model before model mixin when a prefix of the keyword is typed', () => {
      const { items, sourceFile, cursorOffset } = complete('mo|');
      const range = {
        start: sourceFile.positionAt(cursorOffset - 'mo'.length),
        end: sourceFile.positionAt(cursorOffset),
      };

      expect(sortedLabels(items).slice(0, 2)).toEqual(['model', 'model mixin']);
      expect(completionItemByLabel(items, 'model mixin')).toMatchObject({
        kind: CompletionItemKind.Keyword,
        detail: 'Declares a mixin for model blocks.',
        filterText: 'model mixin',
        sortText: '0:model mixin',
        textEdit: { range, newText: 'model mixin ' },
      });
    });

    it('sorts each mixin item directly after the item of its keyword', () => {
      expect(sortedLabels(complete('|').items)).toEqual([
        'model',
        'model mixin',
        'namespace',
        'type',
        'type mixin',
        'types',
        'audit',
        'audit mixin',
        'inventory',
        'inventory mixin',
        'policy',
        'policy mixin',
      ]);
    });

    it('offers no mixin item for namespace or types, and never the word mixin alone', () => {
      const labels = complete('|').items.map((item) => item.label);

      expect(labels).not.toContain('namespace mixin');
      expect(labels).not.toContain('types mixin');
      expect(labels).not.toContain('mixin');
    });

    it('inserts a mixin declaration with an empty body for a native and for a struct block keyword', () => {
      const { items } = completeWithSource({
        markedSource: '|',
        clientSupportsSnippets: true,
        pslBlockDescriptors: {
          security: {
            policy: {
              kind: 'pslBlock',
              keyword: 'policy',
              discriminator: 'policy',
              name: { required: true },
              spec: policySpec,
              attributes: { audit: () => auditAttribute },
            },
          },
        },
      });

      expect(completionItemByLabel(items, 'model mixin')).toMatchObject({
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: { newText: `model mixin ${nameSnippetPlaceholder} {\n  \${0:// Fields}\n}` },
      });
      expect(completionItemByLabel(items, 'policy mixin')).toMatchObject({
        kind: CompletionItemKind.Keyword,
        detail: 'Declares a mixin for policy blocks.',
        filterText: 'policy mixin',
        sortText: '1:policy mixin',
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: {
          newText: `policy mixin ${nameSnippetPlaceholder} {\n  \${0:// Block keys and attributes}\n}`,
        },
      });
    });

    it('offers the mixin item while the whole keyword is the word before the cursor, and nothing once more is typed', () => {
      expect(complete('model|').items.map((item) => item.label)).toContain('model mixin');
      expect(complete('model m|').items).toEqual([]);
      expect(complete('model mixin|').items).toEqual([]);
    });

    it.each([
      ['a model', ['model User {', '  |', '}']],
      ['a block', ['policy P {', '  |', '}']],
      ['a model mixin', ['model mixin M {', '  |', '}']],
      ['a block mixin', ['policy mixin M {', '  |', '}']],
    ])('offers none inside %s', (_where, lines) => {
      const labels = complete(lines.join('\n')).items.map((item) => item.label);

      expect(labels.filter((label) => label.endsWith(' mixin'))).toEqual([]);
    });
  });
});
