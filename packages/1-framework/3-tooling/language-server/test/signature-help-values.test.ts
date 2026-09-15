import {
  assembleAuthoringContributions,
  assembleControlMutationDefaults,
} from '@internal/framework-components/control';
import {
  buildSymbolTable,
  fieldAttribute,
  funcCall,
  identifier,
  list,
  oneOf,
  optional,
  record,
} from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { expect, it, vi } from 'vitest';
import { MarkupKind } from 'vscode-languageserver';
import { providePslSignatureHelp } from '../src/signature-help';

const ascending = identifier('Asc', { documentation: 'Sort ascending.' });
const parseIdentifier = vi.fn(ascending.parse);
const asc = { ...ascending, parse: parseIdentifier };
const desc = identifier('Desc', { documentation: 'Sort descending.' });
const nested = funcCall('sort', {
  documentation: 'Sorts a value.',
  positional: [{ key: 'direction', type: desc, documentation: 'Nested direction.' }],
});

it.each([
  { type: asc, args: '|', values: '- `Asc`: Sort ascending.' },
  {
    type: oneOf(asc, desc, asc),
    args: '|',
    values: '- `Asc`: Sort ascending.\n- `Desc`: Sort descending.',
  },
  { type: optional(asc), args: '|', values: '- `Asc`: Sort ascending.' },
  { type: oneOf(asc, list(desc)), args: '[|]', values: '- `Desc`: Sort descending.' },
  {
    type: list(oneOf(asc, desc)),
    args: '[|]',
    values: '- `Asc`: Sort ascending.\n- `Desc`: Sort descending.',
  },
  { type: record(asc), args: '{ key: | }', values: '- `Asc`: Sort ascending.' },
  { type: oneOf(asc, nested), args: '|', values: '- `Asc`: Sort ascending.' },
  { type: oneOf(asc, nested), args: 'sort(|)', values: '- `Desc`: Sort descending.' },
])(
  'documents relevant identifier values without parsing: $args / $type.kind',
  ({ type, args, values }) => {
    const spec = fieldAttribute('probe', {
      documentation: 'Tests identifier documentation.',
      positional: [{ key: 'value', type, documentation: 'The declared value.' }],
    });
    const source = `model Example { value String @probe(${args}) }`;
    const offset = source.indexOf('|');
    const { document, sourceFile } = parse(source.replace('|', ''));
    const { table: symbolTable } = buildSymbolTable({
      document,
      sourceFile,
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
    expect(signature?.parameters?.[0]?.documentation).toEqual({
      kind: MarkupKind.Markdown,
      value: `${args.startsWith('sort(') ? '**direction**\n\nNested direction.' : '**value**\n\nThe declared value.'}\n\nAllowed values:\n${values}`,
    });
    expect(parseIdentifier).not.toHaveBeenCalled();
  },
);
