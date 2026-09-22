import {
  assembleAuthoringContributions,
  assembleControlMutationDefaults,
} from '@internal/framework-components/control';
import {
  buildSymbolTable,
  entityRef,
  fieldAttribute,
  funcCall,
  identifier,
  list,
  oneOf,
  optional,
} from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { expect, it, vi } from 'vitest';
import { MarkupKind } from 'vscode-languageserver';
import { providePslSignatureHelp } from '../src/signature-help';

const referenceRule = entityRef({ kind: 'model' });
const parseReference = vi.fn(referenceRule.parse);
const reference = { ...referenceRule, parse: parseReference };
const ascending = identifier('Asc', { documentation: 'Sort ascending.' });
const parseIdentifier = vi.fn(ascending.parse);
const asc = { ...ascending, parse: parseIdentifier };
const desc = identifier('Desc', { documentation: 'Sort descending.' });
const nested = funcCall('sort', {
  documentation: 'Sorts a value.',
  positional: [{ key: 'direction', type: desc, documentation: 'Nested direction.' }],
});

it.each([
  { type: identifier(), args: '|', label: '@probe(identifier)' },
  { type: reference, args: '|', label: '@probe(model reference)' },
  {
    type: optional(list(oneOf(reference, identifier()))),
    args: '|',
    label: '@probe(((model reference | identifier)[])?)',
  },
  { type: oneOf(asc, desc), args: '|', label: '@probe(Asc | Desc)' },
  { type: optional(asc), args: '|', label: '@probe(Asc?)' },
  { type: oneOf(asc, nested), args: 'sort(|)', label: 'sort(Desc)' },
])(
  'keeps allowed values in the signature and declaration-only documentation: $label',
  ({ type, args, label }) => {
    const spec = fieldAttribute('probe', {
      documentation: 'Tests identifier documentation.',
      positional: [{ key: 'value', type, documentation: 'The declared value.' }],
    });
    const source = `model Example { value String @probe(${args}) }`;
    const offset = source.indexOf('|');
    const { document, sources } = parse(source.replace('|', ''), 'language-server-test.psl');
    const sourceFile = sources.sourceFileFor(document.syntax);
    const { symbolTable } = buildSymbolTable({
      documents: [document],
      sources,
      pslBlockDescriptors: {},
    });
    parseIdentifier.mockClear();
    const result = providePslSignatureHelp({
      document,
      sourceFile,
      position: sourceFile.positionAt(offset),
      clientSupportsLabelOffsets: true,
      candidates: {
        symbolTable,
        pslBlockDescriptors: {},
        controlMutationDefaults: assembleControlMutationDefaults([]),
        authoringContributions: assembleAuthoringContributions([
          {
            id: 'values',
            authoring: {
              attributeSpecs: { field: { probe: () => spec }, model: {} },
            },
          },
        ]),
      },
    });
    const signature = result?.signatures[0];
    expect(result?.activeParameter).toBe(0);
    expect(signature?.label).toBe(label);
    expect(signature?.parameters?.[0]?.documentation).toEqual({
      kind: MarkupKind.Markdown,
      value: args.startsWith('sort(')
        ? '**direction**\n\nNested direction.'
        : '**value**\n\nThe declared value.',
    });
    expect(parseIdentifier).not.toHaveBeenCalled();
    expect(parseReference).not.toHaveBeenCalled();
  },
);
