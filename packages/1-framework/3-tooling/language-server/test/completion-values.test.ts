import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import {
  assembleAuthoringContributions,
  assembleControlMutationDefaults,
} from '@internal/framework-components/control';
import {
  type AttributeCtx,
  blockAttribute,
  bool,
  buildSymbolTable,
  entityRef,
  fieldAttribute,
  funcCall,
  identifier,
  int,
  json,
  list,
  modelAttribute,
  num,
  oneOf,
  optional,
  type RejectingArgType,
  record,
  str,
} from '@internal/psl-parser';
import { parse, SourceFile } from '@internal/psl-parser/syntax';
import { describe, expect, it, vi } from 'vitest';
import { InsertTextFormat } from 'vscode-languageserver';
import { classifyPslCompletionContext } from '../src/completion-context';
import { providePslCompletionItems } from '../src/completion-provider';
import {
  provideAttributeArgumentSlotCompletionItems,
  provideAttributeNamedKeyCompletionItems,
  provideAttributeValueCompletionItems,
} from '../src/completion-values';

const emptyTabStop1 = '$' + '{1:}';
const emptyTabStop2 = '$' + '{2:}';
const rejectedParse = vi.fn(() => {
  throw new Error('completion must not parse');
});
const rejecting: RejectingArgType<never, AttributeCtx> = {
  kind: 'rejecting',
  label: 'unavailable',
  message: 'No available values',
  parse: rejectedParse,
};
const direction = oneOf(identifier('Asc'), identifier('Desc'));
const ordered = funcCall('ordered', {
  positional: [{ key: 'direction', type: direction }],
  named: { required: list(bool()), optional: optional(str()), direction },
});
const signature = {
  positional: [{ key: 'value', type: oneOf(identifier('First'), identifier('Second')) }],
  named: {
    mode: oneOf(identifier('Asc'), identifier('Desc'), identifier('Asc')),
    fixed: oneOf(str('quoted"value'), num(-1), bool(), identifier('Fixed')),
    flags: list(bool()),
    matrices: list(list(bool())),
    scalar: bool(),
    call: funcCall('f', { named: { x: bool() } }),
    records: record(list(bool())),
    choice: oneOf(ordered, funcCall('empty', {})),
    nested: funcCall('wrap', {
      positional: [{ key: 'value', type: list(ordered) }],
      named: { extra: optional(bool()) },
    }),
    overlap: oneOf(
      funcCall('same', { named: { first: bool() } }),
      funcCall('same', { named: { second: bool() } }),
    ),
    all: oneOf(str(), identifier('Alpha'), bool(), num(), identifier('Alpha')),
    none: oneOf(str(), num(), int(), json(), entityRef(), rejecting),
    rejected: rejecting,
    recordValues: record(bool()),
    unionLists: oneOf(list(identifier('A')), list(identifier('B')), list(identifier('A'))),
    format: funcCall('format', {
      named: { text: str(), options: record(str()), enabled: optional(bool(), true) },
    }),
  },
};
const fieldSpec = fieldAttribute('probe', signature);
const modelSpec = modelAttribute('probe', signature);
const blockSpec = blockAttribute('probe', signature);
const authoringContributions = assembleAuthoringContributions([
  {
    id: 'completion-fixture',
    authoring: {
      attributeSpecs: { field: { probe: () => fieldSpec }, model: { probe: () => modelSpec } },
    },
  },
]);
const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
  policy: {
    kind: 'pslBlock',
    keyword: 'policy',
    discriminator: 'completion-policy',
    name: { required: true },
    parameters: {},
    attributes: { probe: () => blockSpec },
  },
};

function complete(markedSource: string, snippets = false) {
  const offset = markedSource.indexOf('|');
  expect(offset).toBeGreaterThanOrEqual(0);
  const source = markedSource.slice(0, offset) + markedSource.slice(offset + 1);
  const { document, sourceFile } = parse(source);
  const { table: symbolTable } = buildSymbolTable({ document, sourceFile, pslBlockDescriptors });
  const items = providePslCompletionItems({
    context: classifyPslCompletionContext({
      document,
      sourceFile,
      position: sourceFile.positionAt(offset),
    }),
    sourceFile,
    candidates: {
      scalarTypes: ['String'],
      pslBlockDescriptors,
      symbolTable,
      authoringContributions,
      controlMutationDefaults: assembleControlMutationDefaults([]),
    },
    clientSupportsSnippets: snippets,
  });
  return {
    source,
    items,
    labels: items.map((item) => item.label),
    apply(label: string) {
      const edit = items.find((item) => item.label === label)?.textEdit;
      expect(edit).toBeDefined();
      if (edit === undefined || !('range' in edit)) throw new Error('missing text edit');
      return (
        source.slice(0, sourceFile.offsetAt(edit.range.start)) +
        edit.newText +
        source.slice(sourceFile.offsetAt(edit.range.end))
      );
    },
  };
}

function field(args: string, snippets = false) {
  return complete(`model Example {\n  value String @probe(${args})\n}`, snippets);
}

describe('classified positions without cursor AST', () => {
  it.each([false, true])(
    'uses captured colon presence to gate accepted-key commands: %s',
    (hasColon) => {
      const items = provideAttributeNamedKeyCompletionItems(
        {
          context: {
            offset: 1,
            replacementStartOffset: 0,
            replacementEndOffset: 4,
            attributeName: 'probe',
            path: [],
            existingNamedKeys: [],
            hasColon,
          },
          sourceFile: new SourceFile('mode: Asc'),
          clientSupportsSnippets: true,
          clientSupportsTriggerSuggestCommand: true,
        },
        fieldSpec,
      );
      const item = items.find((candidate) => candidate.label === 'mode');
      expect(item?.textEdit).toEqual({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        newText: hasColon ? 'mode' : `mode: ${emptyTabStop1}`,
      });
      expect(item?.command).toEqual(
        hasColon
          ? undefined
          : {
              title: 'Suggest argument values',
              command: 'editor.action.triggerSuggest',
            },
      );
    },
  );

  it('resolves all matching nested signatures using only a path and existing keys', () => {
    const sourceFile = new SourceFile('');
    const items = provideAttributeNamedKeyCompletionItems(
      {
        context: {
          offset: 0,
          replacementStartOffset: 0,
          replacementEndOffset: 0,
          attributeName: 'probe',
          path: [
            { kind: 'namedArgument', name: 'overlap' },
            { kind: 'functionCall', name: 'same' },
          ],
          existingNamedKeys: ['first'],
          hasColon: true,
        },
        sourceFile,
        clientSupportsSnippets: false,
      },
      fieldSpec,
    );
    expect(items.map((item) => item.label)).toEqual(['second']);
  });

  it('offers both positional values and keys from an explicit ambiguous position', () => {
    const items = provideAttributeArgumentSlotCompletionItems(
      {
        context: {
          offset: 0,
          replacementStartOffset: 0,
          replacementEndOffset: 0,
          attributeName: 'probe',
          path: [
            { kind: 'namedArgument', name: 'choice' },
            { kind: 'functionCall', name: 'ordered' },
          ],
          existingNamedKeys: ['optional'],
          hasColon: false,
          positionalIndex: 0,
        },
        sourceFile: new SourceFile(''),
        clientSupportsSnippets: false,
        fieldNames: () => [],
      },
      fieldSpec,
    );
    expect(items.map((item) => item.label)).toEqual(['Asc', 'Desc', 'required', 'direction']);
  });

  it('preserves callee parentheses and excludes scalar alternatives without inspecting an expression', () => {
    const spec = fieldAttribute('probe', { named: { value: oneOf(bool(), funcCall('f', {})) } });
    const items = provideAttributeValueCompletionItems(
      {
        context: {
          offset: 1,
          replacementStartOffset: 0,
          replacementEndOffset: 1,
          attributeName: 'probe',
          path: [{ kind: 'namedArgument', name: 'value' }],
          syntax: 'functionName',
        },
        sourceFile: new SourceFile('f()'),
        clientSupportsSnippets: true,
        fieldNames: () => [],
      },
      spec,
    );
    expect(
      items.map((item) => ({
        label: item.label,
        newText: item.textEdit?.newText,
        format: item.insertTextFormat,
      })),
    ).toEqual([{ label: 'f', newText: 'f', format: undefined }]);
  });

  it('renders a scalar edit from the supplied span without an attribute or owner AST', () => {
    const sourceFile = new SourceFile('old');
    const items = provideAttributeValueCompletionItems(
      {
        context: {
          offset: 1,
          replacementStartOffset: 0,
          replacementEndOffset: 3,
          attributeName: 'probe',
          path: [{ kind: 'namedArgument', name: 'mode' }],
          syntax: 'scalar',
        },
        sourceFile,
        clientSupportsSnippets: false,
        fieldNames: () => [],
      },
      fieldSpec,
    );
    expect(items.map((item) => item.textEdit)).toEqual(
      ['Asc', 'Desc'].map((newText) => ({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        newText,
      })),
    );
  });
});

describe('named key separators', () => {
  it.each(['|', 'mo|de', 'choice: ordered(|)', 'choice: ordered(dir|ection)'])(
    'inserts a separator and empty value stop for %s',
    (args) => {
      const name = args.includes('ordered') ? 'direction' : 'mode';
      for (const snippets of [false, true]) {
        const result = field(args, snippets);
        const item = result.items.find((candidate) => candidate.label === name);
        expect(item?.textEdit?.newText).toBe(`${name}: ${snippets ? emptyTabStop1 : ''}`);
        expect(item?.insertTextFormat).toBe(snippets ? InsertTextFormat.Snippet : undefined);
        expect(result.apply(name)).not.toContain(`${name}de`);
      }
    },
  );

  it.each(['mo|de:   Asc', 'mo|de :   Asc', 'choice: ordered(dir|ection:   Asc)'])(
    'replaces only the complete key and preserves its existing separator/value: %s',
    (args) => {
      for (const snippets of [false, true]) {
        const result = field(args, snippets);
        const name = args.includes('ordered') ? 'direction' : 'mode';
        expect(result.items.find((item) => item.label === name)?.textEdit?.newText).toBe(name);
        expect(result.apply(name)).toBe(result.source);
      }
    },
  );
});

describe('recursive attribute values', () => {
  it.each([
    ['mode: |', ['Asc', 'Desc']],
    ['mode: A|sc', ['Asc', 'Desc']],
    ['fixed: |', ['"quoted\\"value"', '-1', 'true', 'false', 'Fixed']],
    ['fixed: tr|ue', ['"quoted\\"value"', '-1', 'true', 'false', 'Fixed']],
    ['flags: [|]', ['true', 'false']],
    ['flags: [true, |]', ['true', 'false']],
    ['flags: [fa|lse, true]', ['true', 'false']],
    ['records: { key: [|] }', ['true', 'false']],
    ['records: { "key": [true, |] }', ['true', 'false']],
    ['records: { | }', []],
    ['records: { ke|y: [] }', []],
    ['all: |', ['Alpha', 'true', 'false']],
    ['none: |', []],
    ['rejected: |', []],
    ['recordValues: { enabled: | }', ['true', 'false']],
    ['recordValues: { enabled: true, next: | }', ['true', 'false']],
    ['unionLists: [|]', ['A', 'B']],
    ['flags: [|false]', ['true', 'false']],
  ])('completes %s', (args, expected) => {
    expect(field(args).labels).toEqual(expected);
  });

  it.each([
    'model Example { value String @probe(mode: |',
    'model Example { value String @probe(flags: [|',
    'model Example { value String @probe(records: { key: [|',
  ])('completes incomplete EOF %s', (source) => {
    expect(complete(source).labels).toEqual(
      source.includes('mode:') ? ['Asc', 'Desc'] : ['true', 'false'],
    );
  });

  it('never invokes combinator parsing to select alternatives', () => {
    expect(field('none: |').items).toEqual([]);
    expect(rejectedParse).not.toHaveBeenCalled();
  });

  it('replaces an unfinished string token at EOF', () => {
    expect(
      complete('model Example { value String @probe(fixed: "ol|').apply('"quoted\\"value"'),
    ).toBe('model Example { value String @probe(fixed: "quoted\\"value"');
  });

  it('preserves declaration order through client sort keys', () => {
    const items = field('First, |').items;
    expect(
      [...items]
        .sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? ''))
        .map((item) => item.label),
    ).toEqual(Object.keys(signature.named));
  });

  it('offers positional values alongside available keys', () => {
    expect(field('|').labels).toEqual(['First', 'Second', ...Object.keys(signature.named)]);
  });

  it('does not advance the positional slot for named arguments', () => {
    expect(field('mode: Asc, |').labels).toEqual([
      'First',
      'Second',
      ...Object.keys(signature.named).filter((key) => key !== 'mode'),
    ]);
  });

  it('advances the positional slot only once', () => {
    expect(field('First, |').labels).toEqual(Object.keys(signature.named));
  });

  it.each([
    'model Example { value String @probe(mode: Asc)| }',
    'model Example { value String @probe(mode: Asc)|',
    'model Example { value String @probe(flags: []|) }',
    'model Example { value String @probe(choice: empty()|) }',
    'model Example { value String @probe(records: {}|) }',
    'model Example { value String @probe(mode: Asc // |\n) }',
  ])('does not complete after a closed delimiter or inside a comment: %s', (source) => {
    expect(complete(source).items).toEqual([]);
  });

  it.each([
    ['flags: [true |]', 'flags: [true ]'],
    ['scalar: true |', 'scalar: true '],
    ['call: f |(x: true)', 'call: f (x: true)'],
  ])('does not append another token in completed-expression trivia: %s', (marked, unchanged) => {
    const result = field(marked);
    const candidate = result.items[0];
    const edited = candidate === undefined ? result.source : result.apply(candidate.label);
    const source = `model Example {\n  value String @probe(${unchanged})\n}`;
    expect(parse(source).diagnostics).toEqual([]);
    expect(parse(edited).diagnostics).toEqual([]);
    expect(edited).toBe(source);
    expect(result.items).toEqual([]);
  });

  it.each([
    ['flags: [, |]', ['true', 'false']],
    ['flags: [true,, |]', ['true', 'false']],
    ['matrices: [[, |]]', ['true', 'false']],
    ['records: { key: [, |] }', ['true', 'false']],
    ['choice: ordered(Asc, required: [, |])', ['true', 'false']],
    ['recordValues: { enabled: , next: | }', ['true', 'false']],
    ['recordValues: { enabled: , | }', []],
  ])('retains the nested container after a missing expression: %s', (args, expected) => {
    expect(field(args).labels).toEqual(expected);
  });

  it('returns to the attribute signature after a closed collection', () => {
    expect(field('flags: [true], |').labels).toEqual([
      'First',
      'Second',
      ...Object.keys(signature.named).filter((key) => key !== 'flags'),
    ]);
  });

  it('inserts a recovered list value without replacing an outer argument key', () => {
    expect(field('flags: [, |]').apply('false')).toBe(
      'model Example {\n  value String @probe(flags: [, false])\n}',
    );
  });

  it('completes an escaped nested comma gap at EOF', () => {
    expect(complete('model Example { value String @probe(records: { key: [, |').labels).toEqual([
      'true',
      'false',
    ]);
  });

  it('replaces the full identifier token', () => {
    expect(field('mode: A|sc').apply('Desc')).toBe(
      'model Example {\n  value String @probe(mode: Desc)\n}',
    );
  });

  it('replaces the full quoted literal token without duplicating quotes', () => {
    expect(field('fixed: "ol|d"').apply('"quoted\\"value"')).toBe(
      'model Example {\n  value String @probe(fixed: "quoted\\"value")\n}',
    );
  });

  it('replaces a whole negative numeric token', () => {
    expect(field('fixed: -1|2').apply('-1')).toBe(
      'model Example {\n  value String @probe(fixed: -1)\n}',
    );
  });

  it.each(['model Example { @@probe(mode: |) }', 'policy Example { @@probe(mode: |) }'])(
    'completes values for each concrete owner: %s',
    (source) => {
      expect(complete(source).labels).toEqual(['Asc', 'Desc']);
    },
  );
});

describe('recursive function arguments', () => {
  it('offers function calls from every alternative', () => {
    expect(field('choice: |').labels).toEqual(['ordered', 'empty']);
  });

  it('inserts only required arguments with empty tab stops', () => {
    const result = field('choice: |', true);
    expect(result.items.map((item) => [item.label, item.insertTextFormat])).toEqual([
      ['ordered', InsertTextFormat.Snippet],
      ['empty', InsertTextFormat.Snippet],
    ]);
    expect(result.apply('ordered')).toBe(
      `model Example {\n  value String @probe(choice: ordered(${emptyTabStop1}, required: [${emptyTabStop2}]))\n}`,
    );
    expect(result.apply('empty')).toBe(
      'model Example {\n  value String @probe(choice: empty())\n}',
    );
  });

  it('uses empty string and record tab stops and omits optional defaults', () => {
    expect(field('format: |', true).apply('format')).toBe(
      `model Example {\n  value String @probe(format: format(text: "${emptyTabStop1}", options: { ${emptyTabStop2} }))\n}`,
    );
  });

  it('uses plain function names without snippet syntax for ordinary clients', () => {
    const result = field('choice: |');
    expect(result.items.every((item) => item.insertTextFormat !== InsertTextFormat.Snippet)).toBe(
      true,
    );
    expect(result.apply('ordered')).toBe(
      'model Example {\n  value String @probe(choice: ordered)\n}',
    );
  });

  it('preserves existing function parentheses and arguments', () => {
    expect(field('choice: or|dered(Asc, required: [true])', true).apply('ordered')).toBe(
      'model Example {\n  value String @probe(choice: ordered(Asc, required: [true]))\n}',
    );
  });

  it('offers positional function values and declaration-ordered keys', () => {
    expect(field('choice: ordered(|)').labels).toEqual([
      'Asc',
      'Desc',
      'required',
      'optional',
      'direction',
    ]);
  });

  it('filters supplied keys and retains the currently edited key', () => {
    expect(field('choice: ordered(Asc, optional: "text", req|uired: [])').labels).toEqual([
      'required',
      'direction',
    ]);
  });

  it('binds named function values without advancing positional slots', () => {
    expect(field('choice: ordered(optional: "text", |)').labels).toEqual([
      'Asc',
      'Desc',
      'required',
      'direction',
    ]);
  });

  it('completes nested list values in function named arguments', () => {
    expect(field('choice: ordered(Asc, required: [|])').labels).toEqual(['true', 'false']);
  });

  it('recurses through function, list, and function arguments', () => {
    expect(field('nested: wrap([ordered(direction: |)])').labels).toEqual(['Asc', 'Desc']);
  });

  it('completes a missing nested expression at EOF', () => {
    expect(
      complete('model Example { value String @probe(nested: wrap([ordered(direction: |').labels,
    ).toEqual(['Asc', 'Desc']);
  });

  it('keeps same-name alternatives with different snippet edits', () => {
    const result = field('overlap: |', true);
    expect(result.items.map((item) => item.textEdit?.newText)).toEqual([
      `same(first: ${emptyTabStop1})`,
      `same(second: ${emptyTabStop1})`,
    ]);
  });

  it('combines signatures of matching function alternatives', () => {
    expect(field('overlap: same(|)').labels).toEqual(['first', 'second']);
  });
});
