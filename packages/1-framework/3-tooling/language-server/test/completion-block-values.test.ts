import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { InsertTextFormat } from 'vscode-languageserver';
import { classifyPslCompletionContext } from '../src/completion-context';
import { providePslCompletionItems } from '../src/completion-provider';
import { testBinder } from './helpers/binder';
import { blockValueDescriptors, blockValueSource } from './helpers/block-value-descriptors';

function complete(markedBlock: string, clientSupportsSnippets = false) {
  const markedSource = `${blockValueSource}\n${markedBlock}`;
  const cursorOffset = markedSource.indexOf('|');
  expect(cursorOffset).toBeGreaterThanOrEqual(0);
  const source = `${markedSource.slice(0, cursorOffset)}${markedSource.slice(cursorOffset + 1)}`;
  const { document, sources } = parse(source, 'language-server-test.psl');
  const sourceFile = sources.sourceFileFor(document.syntax);
  const { symbolTable } = buildSymbolTable({ documents: [document], sources });
  const items = providePslCompletionItems({
    context: classifyPslCompletionContext({
      document,
      sourceFile,
      position: sourceFile.positionAt(cursorOffset),
    }),
    sourceFile,
    candidates: {
      binder: testBinder({ sources, symbolTable, pslBlockDescriptors: blockValueDescriptors }),
      scalarTypes: [],
      pslBlockDescriptors: blockValueDescriptors,
      symbolTable,
    },
    clientSupportsSnippets,
  });
  return {
    items,
    labels: items.map((item) => item.label),
    edits: items.map((item) => {
      const edit = item.textEdit;
      if (edit === undefined || !('range' in edit)) throw new Error('Expected a range text edit');
      return {
        start: sourceFile.offsetAt(edit.range.start),
        end: sourceFile.offsetAt(edit.range.end),
        newText: edit.newText,
      };
    }),
    cursorOffset,
  };
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
