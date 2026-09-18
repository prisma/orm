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
const namedTabStop = (index: number, name: string) => `\${${index}:${name}}`;
const rejectedParse = vi.fn(() => {
  throw new Error('completion must not parse');
});
const rejecting: RejectingArgType<never, AttributeCtx> = {
  kind: 'rejecting',
  label: 'unavailable',
  message: 'No available values',
  parse: rejectedParse,
};
const unchecked = { ...identifier(), parse: rejectedParse };
const checked = { ...entityRef({ kind: 'model' }), parse: rejectedParse };
const direction = oneOf(
  identifier('Asc', { documentation: 'An accepted identifier in this test grammar.' }),
  identifier('Desc', { documentation: 'An accepted identifier in this test grammar.' }),
);
const ordered = funcCall('ordered', {
  documentation: 'Orders boolean values in a selected direction.',
  positional: [{ key: 'direction', type: direction, documentation: 'The ordering direction.' }],
  named: {
    required: { type: list(bool()), documentation: 'The values to order.' },
    optional: { type: optional(str()), documentation: 'An optional label for the ordering.' },
    direction: { type: direction, documentation: 'The ordering direction supplied by name.' },
  },
});
const signature = {
  documentation: 'Exercises scalar, collection, and nested-function argument completion.',
  positional: [
    {
      key: 'value',
      type: oneOf(
        identifier('First', { documentation: 'An accepted identifier in this test grammar.' }),
        identifier('Second', { documentation: 'An accepted identifier in this test grammar.' }),
      ),
      documentation: 'The first or second positional choice.',
    },
  ],
  named: {
    mode: {
      type: oneOf(
        identifier('Asc', { documentation: 'An accepted identifier in this test grammar.' }),
        identifier('Desc', { documentation: 'An accepted identifier in this test grammar.' }),
        identifier('Asc', { documentation: 'An accepted identifier in this test grammar.' }),
      ),
      documentation: 'The ascending or descending mode.',
    },
    fixed: {
      type: oneOf(
        str('quoted"value'),
        num(-1),
        bool(),
        identifier('Fixed', { documentation: 'An accepted identifier in this test grammar.' }),
      ),
      documentation: 'A fixed literal or boolean value.',
    },
    flags: { type: list(bool()), documentation: 'A list of boolean flags.' },
    matrices: { type: list(list(bool())), documentation: 'A matrix of boolean values.' },
    scalar: { type: bool(), documentation: 'A single boolean value.' },
    call: {
      type: funcCall('f', {
        documentation: 'Accepts a boolean input.',
        named: { x: { type: bool(), documentation: 'The boolean input.' } },
      }),
      documentation: 'A call with a required boolean argument.',
    },
    records: {
      type: record(list(bool())),
      documentation: 'Lists of boolean values keyed by name.',
    },
    choice: {
      type: oneOf(
        ordered,
        funcCall('empty', { documentation: 'Produces an empty value without arguments.' }),
      ),
      documentation: 'An ordered value or an empty value.',
    },
    nested: {
      type: funcCall('wrap', {
        documentation: 'Wraps a list of ordered values.',
        positional: [
          { key: 'value', type: list(ordered), documentation: 'The ordered values to wrap.' },
        ],
        named: { extra: { type: optional(bool()), documentation: 'An optional extra flag.' } },
      }),
      documentation: 'A wrapper around nested ordering calls.',
    },
    overlap: {
      type: oneOf(
        funcCall('same', {
          documentation: 'Accepts the first boolean variant.',
          named: { first: { type: bool(), documentation: 'The first variant flag.' } },
        }),
        funcCall('same', {
          documentation: 'Accepts the second boolean variant.',
          named: { second: { type: bool(), documentation: 'The second variant flag.' } },
        }),
      ),
      documentation: 'A function whose alternatives share a name.',
    },
    all: {
      type: oneOf(
        str(),
        unchecked,
        checked,
        identifier('Alpha', { documentation: 'An accepted identifier in this test grammar.' }),
        bool(),
        num(),
        identifier('Alpha', { documentation: 'An accepted identifier in this test grammar.' }),
      ),
      documentation: 'A scalar value with enumerated completion candidates.',
    },
    none: {
      type: oneOf(str(), num(), int(), json(), checked, unchecked, rejecting),
      documentation: 'A free-form value without enumerated candidates.',
    },
    rejected: { type: rejecting, documentation: 'A value that always fails interpretation.' },
    recordValues: { type: record(bool()), documentation: 'Boolean values keyed by name.' },
    unionLists: {
      type: oneOf(
        list(unchecked),
        list(checked),
        list(identifier('A', { documentation: 'An accepted identifier in this test grammar.' })),
        list(identifier('B', { documentation: 'An accepted identifier in this test grammar.' })),
        list(identifier('A', { documentation: 'An accepted identifier in this test grammar.' })),
      ),
      documentation: 'A list of `A` or `B` identifiers.',
    },
    format: {
      type: funcCall('format', {
        documentation: 'Formats text using named options.',
        named: {
          text: { type: str(), documentation: 'The text to format.' },
          options: { type: record(str()), documentation: 'Formatting options keyed by name.' },
          enabled: {
            type: optional(bool(), true),
            documentation: 'Whether formatting is enabled. Defaults to true.',
          },
        },
      }),
      documentation: 'A formatting call with required and optional arguments.',
    },
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

function complete(markedSource: string, snippets = false, parameterHints = false) {
  const offset = markedSource.indexOf('|');
  expect(offset).toBeGreaterThanOrEqual(0);
  const source = markedSource.slice(0, offset) + markedSource.slice(offset + 1);
  const { document, sources } = parse(source, 'language-server-test.psl');
  const sourceFile = sources.sourceFileFor(document.syntax);
  const { symbolTable } = buildSymbolTable({ documents: [document], sources, pslBlockDescriptors });
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
    clientSupportsTriggerParameterHintsCommand: parameterHints,
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
          sourceFile: new SourceFile('language-server-test.psl', 'mode: Asc'),
          clientSupportsSnippets: true,
          clientSupportsTriggerSuggestCommand: true,
        },
        fieldSpec,
      );
      const item = items.find((candidate) => candidate.label === 'mode');
      expect(item?.textEdit).toEqual({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        newText: hasColon ? 'mode' : `mode: ${namedTabStop(1, 'mode')}`,
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
    const sourceFile = new SourceFile('language-server-test.psl', '');
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
        sourceFile: new SourceFile('language-server-test.psl', ''),
        clientSupportsSnippets: false,
        fieldNames: () => [],
      },
      fieldSpec,
    );
    expect(items.map((item) => item.label)).toEqual(['Asc', 'Desc', 'required', 'direction']);
  });

  it('preserves callee parentheses and excludes scalar alternatives without inspecting an expression', () => {
    const spec = fieldAttribute('probe', {
      documentation: 'Accepts a boolean or a nullary function call.',
      named: {
        value: {
          type: oneOf(
            bool(),
            funcCall('f', { documentation: 'Produces a value without arguments.' }),
          ),
          documentation: 'The boolean value or function call.',
        },
      },
    });
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
        sourceFile: new SourceFile('language-server-test.psl', 'f()'),
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
    const sourceFile = new SourceFile('language-server-test.psl', 'old');
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

describe('completion details', () => {
  it.each([
    ['mode: |', 'Asc', 'An accepted identifier in this test grammar.'],
    ['|', 'First', 'An accepted identifier in this test grammar.'],
    ['choice: |', 'ordered', 'Orders boolean values in a selected direction.'],
    ['choice: or|dered(Asc)', 'ordered', 'Orders boolean values in a selected direction.'],
    ['|', 'mode', 'The ascending or descending mode.'],
    ['mo|de: Asc', 'mode', 'The ascending or descending mode.'],
    ['choice: ordered(|)', 'required', 'The values to order.'],
    ['choice: ordered(|)', 'optional', 'An optional label for the ordering.'],
    [
      'nested: wrap([ordered(direction: |)])',
      'Desc',
      'An accepted identifier in this test grammar.',
    ],
    ['scalar: |', 'true', 'PSL argument value'],
  ])('uses grammar documentation for %s (%s)', (args, label, detail) => {
    for (const snippets of [false, true]) {
      expect(field(args, snippets).items.find((item) => item.label === label)?.detail).toBe(detail);
    }
  });
});

describe('named key separators', () => {
  it.each(['|', 'mo|de', 'choice: ordered(|)', 'choice: ordered(dir|ection)'])(
    'inserts a separator and named value stop for %s',
    (args) => {
      const name = args.includes('ordered') ? 'direction' : 'mode';
      for (const snippets of [false, true]) {
        const result = field(args, snippets);
        const item = result.items.find((candidate) => candidate.label === name);
        expect(item?.textEdit?.newText).toBe(`${name}: ${snippets ? namedTabStop(1, name) : ''}`);
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

  it('offers only pinned names when unchecked names and checked references are nested alternatives', () => {
    expect(field('none: |').items).toEqual([]);
    expect(field('unionLists: [|]').items.map((item) => item.label)).toEqual(['A', 'B']);
    expect(rejectedParse).not.toHaveBeenCalled();
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
    expect(parse(source, 'language-server-test.psl').diagnostics).toEqual([]);
    expect(parse(edited, 'language-server-test.psl').diagnostics).toEqual([]);
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
  it.each([false, true])('gates function argument hints on client support: %s', (supported) => {
    for (const [args, snippets, label, hints] of [
      ['choice: |', true, 'ordered', true],
      ['choice: |', true, 'empty', false],
      ['choice: |', false, 'ordered', false],
      ['choice: or|dered(Asc)', true, 'ordered', false],
      ['scalar: |', true, 'true', false],
      ['|', true, 'mode', false],
    ] as const) {
      const result = complete(
        `model Example { value String @probe(${args}) }`,
        snippets,
        supported,
      );
      const item = result.items.find((candidate) => candidate.label === label);
      expect(item).toBeDefined();
      expect(item?.command).toEqual(
        supported && hints
          ? { title: 'Show argument hints', command: 'editor.action.triggerParameterHints' }
          : undefined,
      );
    }
  });

  it('places the cursor inside optional-only function arguments', () => {
    const spec = fieldAttribute('probe', {
      documentation: 'Optional call fixture.',
      positional: [
        {
          key: 'value',
          documentation: 'A call.',
          type: funcCall('optionalCall', {
            documentation: 'Optional input.',
            positional: [
              { key: 'value', type: optional(bool()), documentation: 'An optional flag.' },
            ],
          }),
        },
      ],
    });
    const items = provideAttributeArgumentSlotCompletionItems(
      {
        context: {
          offset: 0,
          replacementStartOffset: 0,
          replacementEndOffset: 0,
          attributeName: 'probe',
          path: [],
          existingNamedKeys: [],
          hasColon: false,
          positionalIndex: 0,
        },
        sourceFile: new SourceFile('language-server-test.psl', ''),
        clientSupportsSnippets: true,
        clientSupportsTriggerParameterHintsCommand: true,
        fieldNames: () => [],
      },
      spec,
    );
    expect(items[0]).toMatchObject({
      textEdit: { newText: `optionalCall(${emptyTabStop1})` },
      command: { title: 'Show argument hints', command: 'editor.action.triggerParameterHints' },
    });
  });

  it('offers function calls from every alternative', () => {
    expect(field('choice: |').labels).toEqual(['ordered', 'empty']);
  });

  it('inserts only required arguments with named tab stops', () => {
    const result = field('choice: |', true);
    expect(result.items.map((item) => [item.label, item.insertTextFormat])).toEqual([
      ['ordered', InsertTextFormat.Snippet],
      ['empty', InsertTextFormat.Snippet],
    ]);
    expect(result.apply('ordered')).toBe(
      `model Example {\n  value String @probe(choice: ordered(${namedTabStop(1, 'direction')}, required: [${namedTabStop(2, 'required')}]))\n}`,
    );
    expect(result.apply('empty')).toBe(
      'model Example {\n  value String @probe(choice: empty())\n}',
    );
  });

  it('uses named string and record tab stops and omits optional defaults', () => {
    expect(field('format: |', true).apply('format')).toBe(
      `model Example {\n  value String @probe(format: format(text: "${namedTabStop(1, 'text')}", options: { ${namedTabStop(2, 'options')} }))\n}`,
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
      `same(first: ${namedTabStop(1, 'first')})`,
      `same(second: ${namedTabStop(1, 'second')})`,
    ]);
  });

  it('combines signatures of matching function alternatives', () => {
    expect(field('overlap: same(|)').labels).toEqual(['first', 'second']);
  });
});
