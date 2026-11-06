import { buildSymbolTable, createBinder } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { classifyPslCompletionContext } from '../../../../packages/1-framework/3-tooling/language-server/src/completion-context';
import { providePslCompletionItems } from '../../../../packages/1-framework/3-tooling/language-server/src/completion-provider';
import { providePslHover } from '../../../../packages/1-framework/3-tooling/language-server/src/hover';
import {
  binderContextFromStack,
  type LspControlStack,
} from '../../../../packages/1-framework/3-tooling/language-server/src/lsp-control-stack';
import { composePostgresStack, readPsl } from '../psl-print/print-and-read-back';

const controlStack = composePostgresStack();
const stack: LspControlStack = {
  scalarTypes: [],
  defaultNamespaceId: 'public',
  pslBlockDescriptors: controlStack.authoringContributions.pslBlockDescriptors,
  authoringContributions: controlStack.authoringContributions,
  controlMutationDefaults: controlStack.controlMutationDefaults,
  generatorFunctions: controlStack.generatorFunctions,
  dataTypes: controlStack.dataTypes,
};

function documentAt(markedSource: string) {
  const offset = markedSource.indexOf('|');
  const source = markedSource.slice(0, offset) + markedSource.slice(offset + 1);
  const { document, sources } = parse(source, 'schema.prisma');
  const sourceFile = sources.sourceFileFor(document.syntax);
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    defaultNamespaceId: 'public',
  });
  const { binder } = createBinder({ sources, symbolTable, context: binderContextFromStack(stack) });
  return {
    document,
    sources,
    sourceFile,
    symbolTable,
    binder,
    position: sourceFile.positionAt(offset),
  };
}

function hoverText(markedSource: string): string {
  const { document, sources, sourceFile, binder, position } = documentAt(markedSource);
  const contents = providePslHover({
    document,
    sourceFile,
    position,
    binder,
    pslBlockDescriptors: stack.pslBlockDescriptors,
    dataTypes: controlStack.dataTypes,
    sources,
  })?.contents;
  return typeof contents === 'object' && contents !== null && 'value' in contents
    ? contents.value
    : '';
}

const field = (type: string) => `model Account {\n  id Int @id\n  value ${type}\n}\n`;

describe('the language server with the PostgreSQL convenience scalar types', () => {
  it.each([
    [
      'Str|ing(storage: varchar, length: 12)',
      'String(storage: varchar, length: 12)',
      'Varchar(length: 12)',
    ],
    [
      'Dec|imal(precision: 10, scale: 2)',
      'Decimal(precision: 10, scale: 2)',
      'NumericString(precision: 10, scale: 2)',
    ],
    ['Big|Int(as: number)', 'BigInt(as: number)', 'Int8Number'],
    ['I|nt', 'Int', 'Int4'],
  ])('hovers %s with the explicit type it becomes', async (marked, call, explicit) => {
    expect(hoverText(field(marked))).toContain(`\`${call}\` is exactly \`${explicit}\`.`);
    expect(await readPsl(`// use prisma-8\n\n${field(explicit)}`)).toEqual(
      await readPsl(`// use prisma-8\n\n${field(call)}`),
    );
  });

  it('hovers BigInt with each of its rows', () => {
    expect(hoverText(field('Big|Int'))).toContain(
      [
        '| as | storage | Becomes |',
        '| --- | --- | --- |',
        '| bigint (default) | int8 (default) | `Int8BigInt` |',
        '| number | int8 (default) | `Int8Number` |',
        '| bigint (default) | numeric | `NumericBigInt` |',
      ].join('\n'),
    );
  });

  it('tags each deprecated alias in completion, and nothing else, naming its replacement', () => {
    const { document, sourceFile, symbolTable, binder, position } = documentAt(field('|'));
    const items = providePslCompletionItems({
      context: classifyPslCompletionContext({ document, sourceFile, position }),
      sourceFile,
      candidates: { ...stack, binder, symbolTable },
      clientSupportsSnippets: false,
      clientSupportsTriggerSuggestCommand: false,
      clientSupportsTriggerParameterHintsCommand: false,
    });
    const tagged = items
      .filter((item) => item.tags !== undefined)
      .map((item) => [item.label, item.detail]);
    expect(Object.fromEntries(tagged)).toEqual({
      SmallInt: expect.stringContaining('Deprecated: use Int2.'),
      BigIntNumber: expect.stringContaining('Deprecated: use Int8Number.'),
      Numeric: expect.stringContaining('Deprecated: use NumericString.'),
      UnboundedInt: expect.stringContaining('Deprecated: use NumericBigInt.'),
      Real: expect.stringContaining('Deprecated: use Float4.'),
      VarChar: expect.stringContaining('Deprecated: use Varchar.'),
      VarBit: expect.stringContaining('Deprecated: use Varbit.'),
    });
  });
});
