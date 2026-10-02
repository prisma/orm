import type {
  AuthoringPslBlockDescriptorNamespace,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import {
  type BlockSpecContext,
  blockAttribute,
  buildSymbolTable,
  EMPTY_DATA_TYPES,
  optional,
  str,
  structBlock,
} from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { classifyPslCompletionContext } from '../src/completion-context';
import { providePslCompletionItems } from '../src/completion-provider';
import { testBinder } from './helpers/binder';

function recordingDescriptors(seen: BlockSpecContext[]): AuthoringPslBlockDescriptorNamespace {
  return {
    policy: {
      kind: 'pslBlock',
      keyword: 'policy',
      discriminator: 'fixture-policy',
      name: { required: true },
      spec: (ctx: BlockSpecContext) => {
        seen.push(ctx);
        return structBlock({
          parameters: { using: { type: optional(str()), documentation: 'The predicate.' } },
        });
      },
      attributes: {
        audit: (ctx: BlockSpecContext) => {
          seen.push(ctx);
          return blockAttribute('audit', {
            documentation: 'Audits the policy.',
            named: { reason: { type: optional(str()), documentation: 'The reason.' } },
          });
        },
      },
    },
  };
}

function completeAt(markedSource: string, dataTypes: DataTypeSupport | undefined) {
  const seen: BlockSpecContext[] = [];
  const cursorOffset = markedSource.indexOf('|');
  const source = `${markedSource.slice(0, cursorOffset)}${markedSource.slice(cursorOffset + 1)}`;
  const { document, sources } = parse(source, 'block-spec-context.psl');
  const sourceFile = sources.sourceFileFor(document.syntax);
  const { symbolTable } = buildSymbolTable({ documents: [document], sources });
  const pslBlockDescriptors = recordingDescriptors(seen);
  const items = providePslCompletionItems({
    context: classifyPslCompletionContext({
      document,
      sourceFile,
      position: sourceFile.positionAt(cursorOffset),
    }),
    sourceFile,
    candidates: {
      scalarTypes: [],
      pslBlockDescriptors,
      symbolTable,
      binder: testBinder({
        sources,
        symbolTable,
        pslBlockDescriptors,
        ...(dataTypes === undefined ? {} : { dataTypes }),
      }),
      ...(dataTypes === undefined ? {} : { dataTypes }),
    },
    clientSupportsSnippets: false,
    clientSupportsTriggerParameterHintsCommand: false,
  });
  return { items, seen };
}

const BLOCK_KEY = ['policy Rule {', '  |', '}'].join('\n');
const BLOCK_ATTRIBUTE_ARGUMENT = ['policy Rule {', '  @@audit(|)', '}'].join('\n');

describe('block spec context in the language server', () => {
  it.each([
    ['block key completion', BLOCK_KEY, 'using'],
    ['block attribute argument completion', BLOCK_ATTRIBUTE_ARGUMENT, 'reason'],
  ])("%s receives the source's data types", (_, markedSource, label) => {
    const dataTypes: DataTypeSupport = { entries: {}, lookup: createDataTypeLookup([]) };

    const { items, seen } = completeAt(markedSource, dataTypes);

    expect(items.map((item) => item.label)).toContain(label);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((ctx) => ctx.dataTypes !== dataTypes)).toEqual([]);
  });

  it.each([
    ['block key completion', BLOCK_KEY, 'using'],
    ['block attribute argument completion', BLOCK_ATTRIBUTE_ARGUMENT, 'reason'],
  ])('%s receives no data types when the source has none', (_, markedSource, label) => {
    const { items, seen } = completeAt(markedSource, undefined);

    expect(items.map((item) => item.label)).toContain(label);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((ctx) => ctx.dataTypes !== EMPTY_DATA_TYPES)).toEqual([]);
  });
});
