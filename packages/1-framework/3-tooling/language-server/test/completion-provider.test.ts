import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { CompletionItemKind, CompletionItemTag, InsertTextFormat } from 'vscode-languageserver';
import {
  complete,
  completeWithSource,
  completionItemByLabel,
  constructorArgumentDataTypes,
  pslBlockDescriptors,
} from './helpers/completion-provider';

describe('providePslCompletionItems', () => {
  it('filters candidates after nearest-name shadowing and includes namespace locals', () => {
    const { items } = completeWithSource({
      pslBlockDescriptors,
      markedSource: `model Shared { id Int }
model ZRoot { id Int }
type ZAddress { value String }
namespace app {
  enum Shared { VALUE }
  model Int { id String }
  model Local { value | }
  type Address { value String }
}
namespace other { model Hidden { id Int } }`,
    });
    expect(items.map(({ label, detail }) => [label, detail]).sort()).toEqual([
      ['Address', 'Composite type'],
      ['Boolean', 'Configured scalar type'],
      ['DateTime', 'Configured scalar type'],
      ['Int', 'Model'],
      ['Local', 'Model'],
      ['String', 'Configured scalar type'],
      ['ZAddress', 'Composite type'],
      ['ZRoot', 'Model'],
      ['app', 'Namespace'],
      ['other', 'Namespace'],
      ['public', 'Namespace'],
    ]);
    expect(items.find(({ label }) => label === 'Int')?.kind).toBe(CompletionItemKind.Class);
  });

  it('enumerates only contributed members for a qualified completion', () => {
    const { items } = completeWithSource({
      markedSource: 'model Top { id Int }\nmodel Owner { value custom.| }',
      pslBlockDescriptors: {},
      authoringContributions: assembleAuthoringContributions([
        {
          id: 'constructors',
          authoring: {
            type: {
              custom: {
                Value: {
                  kind: 'typeConstructor',
                  documentation: 'Custom value',
                  output: { codecId: 'value' },
                },
              },
            },
          },
        },
      ]),
    });
    expect(items.map(({ label, kind, detail }) => ({ label, kind, detail }))).toEqual([
      { label: 'Value', kind: CompletionItemKind.Class, detail: 'Custom value' },
    ]);
  });

  it.each([false, true])('inserts namespace dots with negotiated suggestions: %s', (supported) => {
    for (const qualifier of ['', 'custom.']) {
      const { items } = completeWithSource({
        markedSource: `namespace local {}\nmodel Owner { value ${qualifier}| }`,
        pslBlockDescriptors: {},
        clientSupportsSnippets: supported,
        clientSupportsTriggerSuggestCommand: supported,
        authoringContributions: assembleAuthoringContributions([
          { id: 'namespaces', authoring: { type: { custom: { nested: {} } } } },
        ]),
      });
      for (const label of qualifier === '' ? ['local', 'custom'] : ['nested']) {
        const item = completionItemByLabel(items, label);
        expect({
          label: item.label,
          kind: item.kind,
          filterText: item.filterText,
          newText: item.textEdit?.newText,
          format: item.insertTextFormat,
          command: item.command,
        }).toEqual({
          label,
          kind: CompletionItemKind.Module,
          filterText: label,
          newText: `${label}.`,
          format: undefined,
          command: supported
            ? { title: 'Suggest namespace members', command: 'editor.action.triggerSuggest' }
            : undefined,
        });
      }
    }
  });

  it.each([false, true])(
    'renders scalar and constructor presentations with snippets: %s',
    (snippets) => {
      const types: AuthoringTypeNamespace = {
        Scalar: {
          kind: 'typeConstructor',
          output: { codecId: 'fixture/value' },
        },
        Deprecated: {
          kind: 'typeConstructor',
          deprecated: { replacement: 'Scalar' },
          output: { codecId: 'fixture/value' },
        },
        Empty: {
          kind: 'typeConstructor',
          args: [],
          output: { codecId: 'fixture/value' },
        },
        Required: {
          kind: 'typeConstructor',
          args: [
            { name: 'size', kind: 'value', dataType: 'fixture/int' },
            { name: 'label', kind: 'value', dataType: 'fixture/expression' },
            { name: 'scale', kind: 'value', dataType: 'fixture/int', optional: true },
          ],
          output: { codecId: 'fixture/value' },
        },
        Optional: {
          kind: 'typeConstructor',
          args: [{ name: 'size', kind: 'value', dataType: 'fixture/int', optional: true }],
          output: { codecId: 'fixture/value' },
        },
        Entity: {
          kind: 'typeConstructor',
          entityRefArg: { index: 0, entityKind: 'choice' },
          output: { codecId: 'fixture/value' },
        },
      };
      for (const qualifier of ['', 'custom.']) {
        const { items } = completeWithSource({
          markedSource: `model Owner { value ${qualifier}| }`,
          pslBlockDescriptors: {},
          scalarTypes: [],
          clientSupportsSnippets: snippets,
          authoringContributions: assembleAuthoringContributions([
            { id: 'constructors', authoring: { type: { ...types, custom: types } } },
          ]),
          dataTypes: constructorArgumentDataTypes,
        });
        for (const [label, snippet] of [
          ['Scalar', 'Scalar'],
          ['Deprecated', 'Deprecated'],
          ['Empty', 'Empty()'],
          ['Required', 'Required($' + '{1:size}, sql`$' + '{2:label}`)'],
          ['Optional', 'Optional($' + '{1:})'],
          ['Entity', 'Entity($' + '{1:choice})'],
        ] as const) {
          const item = completionItemByLabel(items, label);
          const callable = label !== 'Scalar' && label !== 'Deprecated';
          expect({
            label: item.label,
            kind: item.kind,
            newText: item.textEdit?.newText,
            format: item.insertTextFormat,
            command: item.command,
            tags: item.tags,
          }).toEqual({
            label,
            kind: callable ? CompletionItemKind.Function : CompletionItemKind.Class,
            newText: snippets ? snippet : callable ? `${label}()` : label,
            format: callable && snippets ? InsertTextFormat.Snippet : undefined,
            command: undefined,
            tags: label === 'Deprecated' ? [CompletionItemTag.Deprecated] : undefined,
          });
        }
      }
    },
  );

  it('renders a contributed type alias as a type with its documentation', () => {
    const now = { name: 'now', args: {} } as const;
    const { items } = completeWithSource({
      markedSource: 'model Owner { value temporal.| }',
      pslBlockDescriptors: {},
      scalarTypes: [],
      clientSupportsSnippets: true,
      authoringContributions: assembleAuthoringContributions([
        {
          id: 'aliases',
          authoring: {
            type: {
              temporal: {
                CreatedAt: {
                  kind: 'typeAlias',
                  documentation: 'Set to now when a row is created.',
                  output: { type: { codecId: 'fixture/value' }, onCreate: now },
                },
                UpdatedAt: {
                  kind: 'typeAlias',
                  output: { type: { codecId: 'fixture/value' }, onCreate: now, onUpdate: now },
                },
              },
            },
          },
        },
      ]),
    });
    expect(
      items.map((item) => ({
        label: item.label,
        kind: item.kind,
        detail: item.detail,
        newText: item.textEdit?.newText,
        format: item.insertTextFormat,
      })),
    ).toEqual([
      {
        label: 'CreatedAt',
        kind: CompletionItemKind.Class,
        detail: 'Set to now when a row is created.',
        newText: 'CreatedAt',
        format: undefined,
      },
      {
        label: 'UpdatedAt',
        kind: CompletionItemKind.Class,
        detail: 'Type alias',
        newText: 'UpdatedAt',
        format: undefined,
      },
    ]);
  });

  it('completes a type choice as its bare name, which writes its default choice', () => {
    const { items } = completeWithSource({
      markedSource: 'model Owner { value | }',
      pslBlockDescriptors: {},
      scalarTypes: [],
      clientSupportsSnippets: true,
      authoringContributions: assembleAuthoringContributions([
        {
          id: 'choices',
          authoring: {
            type: {
              Moment: {
                kind: 'typeChoice',
                documentation: 'A moment in time.',
                args: [
                  {
                    kind: 'option',
                    name: 'as',
                    values: ['date', 'text'],
                    default: 'date',
                    optional: true,
                  },
                ],
                choices: [
                  { when: { as: 'date' }, type: 'Stamp' },
                  { when: { as: 'text' }, type: 'Stamp' },
                ],
              },
              Undocumented: {
                kind: 'typeChoice',
                args: [],
                choices: [{ when: {}, type: 'Stamp' }],
              },
              Stamp: { kind: 'typeConstructor', output: { codecId: 'fixture/value' } },
            },
          },
        },
      ]),
    });
    expect(
      items
        .filter((item) => item.label === 'Moment' || item.label === 'Undocumented')
        .map((item) => ({
          kind: item.kind,
          detail: item.detail,
          newText: item.textEdit?.newText,
          format: item.insertTextFormat,
        })),
    ).toEqual([
      {
        kind: CompletionItemKind.Class,
        detail: 'A moment in time.',
        newText: 'Moment',
        format: undefined,
      },
      {
        kind: CompletionItemKind.Class,
        detail: 'Convenience type',
        newText: 'Undocumented',
        format: undefined,
      },
    ]);
  });

  it('does not complete a global namespace when its qualifier is shadowed locally', () => {
    const { items } = complete(`namespace remote { model Item { id Int } }
namespace app {
  model remote { id Int }
  model Owner { value remote.| }
}`);
    expect(items).toEqual([]);
  });

  it('returns an empty list for unsupported classifier contexts', () => {
    const { items } = complete(['model Post {', '  // @|', '}'].join('\n'));

    expect(items).toEqual([]);
  });
});
