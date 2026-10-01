import { describe, expect, it } from 'vitest';
import { CompletionItemKind } from 'vscode-languageserver';
import { completeBlockValueSource } from './helpers/block-value-completion';

const namespacedSource = [
  'model User {',
  '  id Int',
  '}',
  'role admin {',
  '}',
  'namespace auth {',
  '  model Account {',
  '    id Int',
  '  }',
  '  role auditor {',
  '  }',
  '}',
  'namespace reporting {',
  '  model Report {',
  '    id Int',
  '  }',
  '}',
].join('\n');

function complete(markedBlock: string) {
  return completeBlockValueSource(`${namespacedSource}\n${markedBlock}`, {
    clientSupportsTriggerSuggestCommand: true,
  });
}

function topLevelPolicy(entry: string) {
  return complete(['policy_all everything {', `  ${entry}`, '}'].join('\n'));
}

describe('generic block value completion across namespaces', () => {
  it('offers namespaces that contain a matching role alongside top-level roles', () => {
    const result = topLevelPolicy('roles = [|');
    expect(result.labels).toEqual(['admin', 'auth']);
    expect(result.items[1]).toEqual({
      label: 'auth',
      kind: CompletionItemKind.Module,
      detail: 'Namespace',
      filterText: 'auth',
      textEdit: {
        range: {
          start: result.sourceFile.positionAt(result.cursorOffset),
          end: result.sourceFile.positionAt(result.cursorOffset),
        },
        newText: 'auth.',
      },
      command: { title: 'Suggest namespace members', command: 'editor.action.triggerSuggest' },
      sortText: '0001',
    });
  });

  it('offers every namespace that contains a matching model', () => {
    expect(topLevelPolicy('target = |').labels).toEqual(['User', 'auth', 'reporting']);
  });

  it('offers only matching members after a namespace qualifier', () => {
    const result = topLevelPolicy('roles = [auth.A|]');
    expect(result.items).toEqual([
      {
        label: 'auditor',
        kind: CompletionItemKind.Keyword,
        detail: 'role',
        filterText: 'auditor',
        textEdit: {
          range: {
            start: result.sourceFile.positionAt(result.cursorOffset - 1),
            end: result.sourceFile.positionAt(result.cursorOffset),
          },
          newText: 'auditor',
        },
        sortText: '0000',
      },
    ]);
  });

  it.each([
    ['roles = [auth.|', ['auditor']],
    ['roles = [auth.|]', ['auditor']],
    ['roles = [admin, auth.|', ['auditor']],
    ['target = auth.|', ['Account']],
    ['target = reporting.|', ['Report']],
  ])('offers matching members right after a namespace qualifier: %s', (entry, labels) => {
    const result = topLevelPolicy(entry);
    expect(result.items.map((item) => [item.label, item.textEdit])).toEqual(
      labels.map((label) => [
        label,
        {
          range: {
            start: result.sourceFile.positionAt(result.cursorOffset),
            end: result.sourceFile.positionAt(result.cursorOffset),
          },
          newText: label,
        },
      ]),
    );
  });

  it('keeps offering members when the next entry follows on the next line', () => {
    const result = complete(
      ['policy_all everything {', '  roles = [auth.|', '  permissive = true', '}'].join('\n'),
    );
    expect(result.labels).toEqual(['auditor']);
  });

  it('replaces a partially typed member after a namespace qualifier', () => {
    const result = topLevelPolicy('target = auth.Acc|');
    expect(result.edits).toEqual([
      { start: result.cursorOffset - 3, end: result.cursorOffset, newText: 'Account' },
    ]);
  });

  it('offers nothing but entity references after a namespace qualifier', () => {
    expect(topLevelPolicy('permissive = auth.t|').labels).toEqual([]);
  });

  it('offers same-namespace siblings directly to a policy inside the namespace', () => {
    const result = completeBlockValueSource(
      namespacedSource.replace(
        '  role auditor {\n  }\n}',
        '  role auditor {\n  }\n  policy_all own {\n    roles = [|\n  }\n}',
      ),
      { clientSupportsTriggerSuggestCommand: true },
    );
    expect(result.labels).toEqual(['auditor', 'admin', 'auth']);
  });
});
