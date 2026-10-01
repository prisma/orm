import { describe, expect, it } from 'vitest';
import { CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import {
  type BlockValueCompletionOptions,
  completeBlockValueSource,
} from './helpers/block-value-completion';
import { blockValueSource } from './helpers/block-value-descriptors';

function complete(markedBlock: string, clientSupportsSnippets = false) {
  return completeBlockValueSource(`${blockValueSource}\n${markedBlock}`, {
    clientSupportsSnippets,
  });
}

function policy(entry: string) {
  return complete(['policy_select read_own {', `  ${entry}`, '}'].join('\n'));
}

function schedule(entry: string, clientSupportsSnippets = false) {
  return complete(['schedule nightly {', `  ${entry}`, '}'].join('\n'), clientSupportsSnippets);
}

describe('generic block value completion', () => {
  it('offers models in scope for an entity reference', () => {
    expect(policy('target = |').labels).toEqual(['User', 'Post']);
  });

  it.each(['roles = [|', 'roles = [admin, |]'])('offers role blocks in scope: %s', (entry) => {
    expect(policy(entry).labels).toEqual(['admin', 'reader']);
  });

  it('offers boolean literals for a bool parameter', () => {
    expect(policy('permissive = |').labels).toEqual(['true', 'false']);
  });

  it('offers nothing for a free-form string parameter', () => {
    expect(policy('using = |').labels).toEqual([]);
  });

  it('offers nothing for an unknown key', () => {
    expect(policy('unknown = |').labels).toEqual([]);
  });

  it('offers the map value type for any key of a map block', () => {
    const result = complete(['priority levels {', '  anything = |', '}'].join('\n'));
    expect(result.labels).toEqual(['low', 'high']);
  });

  it('replaces a partially typed value identifier', () => {
    const result = policy('target = Us|');
    expect(result.edits).toEqual([
      { start: result.cursorOffset - 2, end: result.cursorOffset, newText: 'User' },
      { start: result.cursorOffset - 2, end: result.cursorOffset, newText: 'Post' },
    ]);
  });

  it('keeps offering list elements in an unclosed list followed by the next entry', () => {
    const result = complete(
      ['policy_select read_own {', '  roles = [admin, |', '  permissive = true', '}'].join('\n'),
    );
    expect(result.labels).toEqual(['admin', 'reader']);
  });

  it('offers the function call for a function-valued parameter', () => {
    const result = schedule('run = |', true);
    expect(
      result.items.map((item) => [item.label, item.textEdit?.newText, item.insertTextFormat]),
    ).toEqual([
      ['every', `every(${'$'}{1:interval}, unit: ${'$'}{2:unit})`, InsertTextFormat.Snippet],
    ]);
  });

  it('offers named keys at a function-call argument slot', () => {
    expect(schedule('run = every(|)').labels).toEqual(['unit', 'jitter']);
  });

  it('offers named keys that are not yet present at a named-key position', () => {
    expect(schedule('run = every(5, jitter: true, un|: seconds)').labels).toEqual(['unit']);
  });

  it('offers values for a named function-call argument', () => {
    expect(schedule('run = every(5, unit: |)').labels).toEqual(['seconds', 'minutes']);
  });
});

describe('generic block key completion', () => {
  function keys(entry: string, options: BlockValueCompletionOptions = {}) {
    return completeBlockValueSource(
      `${blockValueSource}\n${['policy_select read_own {', `  ${entry}`, '}'].join('\n')}`,
      options,
    );
  }

  function keyItem(
    result: ReturnType<typeof keys>,
    label: string,
    detail: string,
    sortText: string,
    newText: string,
    start = result.cursorOffset,
  ) {
    return {
      label,
      kind: CompletionItemKind.Property,
      detail,
      sortText,
      filterText: label,
      textEdit: {
        range: {
          start: result.sourceFile.positionAt(start),
          end: result.sourceFile.positionAt(result.cursorOffset),
        },
        newText,
      },
    };
  }

  const suggest = { title: 'Suggest argument values', command: 'editor.action.triggerSuggest' };

  it('inserts the key with an equals sign', () => {
    const result = keys('|');
    expect(result.items).toEqual([
      keyItem(result, 'target', 'The protected model.', '0000:target', 'target = '),
      keyItem(result, 'roles', 'The roles the policy applies to.', '0001:roles', 'roles = '),
      keyItem(result, 'using', 'The row predicate.', '0002:using', 'using = '),
      keyItem(
        result,
        'permissive',
        'Whether the policy is permissive.',
        '0003:permissive',
        'permissive = ',
      ),
    ]);
  });

  it('opens a list and suggests values when the client supports snippets and commands', () => {
    const result = keys('|', {
      clientSupportsSnippets: true,
      clientSupportsTriggerSuggestCommand: true,
    });
    expect(result.items.slice(0, 2)).toEqual([
      {
        ...keyItem(result, 'target', 'The protected model.', '0000:target', 'target = '),
        command: suggest,
      },
      {
        ...keyItem(
          result,
          'roles',
          'The roles the policy applies to.',
          '0001:roles',
          `roles = [${'$'}1]`,
        ),
        insertTextFormat: InsertTextFormat.Snippet,
        command: suggest,
      },
    ]);
  });

  it('inserts only the key when an equals sign already follows it', () => {
    const result = keys('ro| = [admin]', {
      clientSupportsSnippets: true,
      clientSupportsTriggerSuggestCommand: true,
    });
    expect(result.items.find((item) => item.label === 'roles')).toEqual(
      keyItem(
        result,
        'roles',
        'The roles the policy applies to.',
        '0001:roles',
        'roles',
        result.cursorOffset - 2,
      ),
    );
  });
});

describe('generic block declaration snippets', () => {
  function snippet(keyword: string) {
    const result = completeBlockValueSource(`${blockValueSource}\n|`, {
      clientSupportsSnippets: true,
    });
    return result.items.find((item) => item.label === keyword)?.textEdit?.newText;
  }

  const name = `${'$'}{1:Name}`;

  it('fills in the required parameters of a policy block', () => {
    expect(snippet('policy_select')).toBe(
      [`policy_select ${name} {`, `  target = ${'$'}{2:target}`, `  ${'$'}0`, '}'].join('\n'),
    );
  });

  it('opens a list for required list parameters', () => {
    expect(snippet('grant')).toBe(
      [
        `grant ${name} {`,
        `  roles = [${'$'}{2:roles}]`,
        `  target = ${'$'}{3:target}`,
        `  ${'$'}0`,
        '}',
      ].join('\n'),
    );
  });

  it.each(['priority', 'role'])('keeps the plain snippet for %s', (keyword) => {
    expect(snippet(keyword)).toBe(
      [`${keyword} ${name} {`, `  ${'$'}{0:// Block keys and attributes}`, '}'].join('\n'),
    );
  });
});
