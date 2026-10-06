import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { expect } from 'vitest';
import { classifyPslCompletionContext } from '../../src/completion-context';
import { providePslCompletionItems } from '../../src/completion-provider';
import { testBinder } from './binder';
import { blockValueDescriptors } from './block-value-descriptors';

export interface BlockValueCompletionOptions {
  readonly clientSupportsSnippets?: boolean;
  readonly clientSupportsTriggerSuggestCommand?: boolean;
}

export function completeBlockValueSource(
  markedSource: string,
  options: BlockValueCompletionOptions = {},
) {
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
    clientSupportsSnippets: options.clientSupportsSnippets === true,
    clientSupportsTriggerSuggestCommand: options.clientSupportsTriggerSuggestCommand === true,
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
    sourceFile,
    cursorOffset,
  };
}
