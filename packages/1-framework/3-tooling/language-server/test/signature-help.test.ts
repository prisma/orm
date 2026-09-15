import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import {
  assembleAuthoringContributions,
  assembleControlMutationDefaults,
} from '@internal/framework-components/control';
import {
  blockAttribute,
  bool,
  buildSymbolTable,
  fieldAttribute,
  funcCall,
  list,
  modelAttribute,
  oneOf,
  optional,
  record,
  str,
} from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it, vi } from 'vitest';
import { MarkupKind } from 'vscode-languageserver';
import { providePslSignatureHelp } from '../src/signature-help';

const parseArgument = vi.fn(str().parse);
const text = { ...str(), parse: parseArgument };
const nested = funcCall('nested', {
  documentation: '**Nested** function.',
  positional: [{ key: 'value', type: text, documentation: 'Nested *value*.' }],
  named: { flag: { type: optional(bool()), documentation: 'Nested flag.' } },
});
const signature = {
  documentation: '**Extension** attribute.',
  positional: [{ key: 'value', type: text, documentation: 'The *value*.' }],
  named: {
    value: { type: text, documentation: 'The named *value*.' },
    flag: { type: optional(bool(), true), documentation: 'An optional flag.' },
    call: { type: nested, documentation: 'A nested call.' },
    collection: { type: list(nested), documentation: 'Nested calls in a list.' },
    records: { type: record(nested), documentation: 'Nested calls in a record.' },
    choice: {
      type: oneOf(
        funcCall('choose', {
          documentation: 'Choose by text.',
          named: { text: { type: text, documentation: 'Text choice.' } },
        }),
        funcCall('choose', {
          documentation: 'Choose by flag.',
          named: { flag: { type: bool(), documentation: 'Flag choice.' } },
        }),
      ),
      documentation: 'A choice of signatures.',
    },
    empty: {
      type: funcCall('empty', { documentation: 'No parameters.' }),
      documentation: 'A parameterless call.',
    },
  },
};
const wrappedSpec = fieldAttribute('wrapped', {
  documentation: 'A wrapper attribute.',
  positional: [
    {
      key: 'call',
      type: funcCall('wrap', {
        documentation: 'Wraps another call.',
        positional: [{ key: 'inner', type: nested, documentation: 'The wrapped call.' }],
      }),
      documentation: 'The wrapper call.',
    },
  ],
});
const fieldSpec = fieldAttribute('probe', signature);
const modelSpec = modelAttribute('probe', { ...signature, documentation: '**Model** attribute.' });
const blockSpec = blockAttribute('probe', { ...signature, documentation: '**Block** attribute.' });
const pairSpec = fieldAttribute('pair', {
  documentation: 'Two positional parameters.',
  positional: [
    { key: 'text', type: text, documentation: 'First parameter.' },
    { key: 'call', type: nested, documentation: 'Second parameter.' },
  ],
});
const authoringContributions = assembleAuthoringContributions([
  {
    id: 'signature-fixture',
    authoring: {
      attributeSpecs: {
        field: {
          probe: () => fieldSpec,
          pair: () => pairSpec,
          wrapped: () => wrappedSpec,
          repeated: () =>
            fieldAttribute('repeated', {
              documentation: 'Repeated types.',
              positional: [
                { key: 'first', type: text, documentation: 'First text.' },
                { key: 'second', type: text, documentation: 'Second text.' },
                {
                  key: 'last',
                  type: optional(oneOf(str(), bool())),
                  documentation: 'Optional value.',
                },
              ],
            }),
        },
        model: { probe: () => modelSpec },
      },
    },
  },
]);
const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
  policy: {
    kind: 'pslBlock',
    keyword: 'policy',
    discriminator: 'signature-policy',
    name: { required: true },
    parameters: {},
    attributes: { probe: () => blockSpec },
  },
};

function help(markedSource: string, labelOffsets = true) {
  const offset = markedSource.indexOf('|');
  expect(offset).toBeGreaterThanOrEqual(0);
  const { document, sourceFile } = parse(markedSource.replace('|', ''));
  const { table: symbolTable } = buildSymbolTable({ document, sourceFile, pslBlockDescriptors });
  parseArgument.mockClear();
  const result = providePslSignatureHelp({
    document,
    sourceFile,
    position: sourceFile.positionAt(offset),
    clientSupportsLabelOffsets: labelOffsets,
    candidates: {
      pslBlockDescriptors,
      symbolTable,
      authoringContributions,
      controlMutationDefaults: assembleControlMutationDefaults([]),
    },
  });
  expect(parseArgument).not.toHaveBeenCalled();
  return result;
}

function field(args: string) {
  return help(`model Example {\n value String @probe(${args})\n}`);
}

const markdown = (value: string) => ({ kind: MarkupKind.Markdown, value });

function selected(markedSource: string) {
  const result = help(markedSource);
  expect(result).not.toBeNull();
  const active = result?.signatures[result.activeSignature ?? 0];
  return {
    label: active?.label,
    documentation: active?.documentation,
    activeParameter: result?.activeParameter,
    parameter: active?.parameters?.[result?.activeParameter ?? -1],
  };
}

const attributeLabel =
  '@probe(string, flag?: boolean, call: nested(), collection: nested()[], records: { [key]: nested() }, choice: choose() | choose(), empty: empty())';

describe('providePslSignatureHelp', () => {
  it('renders documented parameters, optional markers, and a single positional/name alias', () => {
    const result = field('|');
    expect(result?.activeSignature).toBe(0);
    expect(result?.activeParameter).toBe(0);
    expect(result?.signatures[0]).toMatchObject({
      label: attributeLabel,
      documentation: markdown('**Extension** attribute.'),
      parameters: [
        {
          label: [7, 13],
          documentation: markdown(
            '**value**\n\nThe *value*.\n\nAccepted positionally or by `value:`.',
          ),
        },
        { label: 'flag?: boolean', documentation: markdown('An optional flag.') },
        { label: 'call: nested()', documentation: markdown('A nested call.') },
        { label: 'collection: nested()[]', documentation: markdown('Nested calls in a list.') },
        {
          label: 'records: { [key]: nested() }',
          documentation: markdown('Nested calls in a record.'),
        },
        {
          label: 'choice: choose() | choose()',
          documentation: markdown('A choice of signatures.'),
        },
        { label: 'empty: empty()', documentation: markdown('A parameterless call.') },
      ],
    });
  });

  it('falls back to string labels for clients without offset support', () => {
    expect(
      help('model Example { value String @pair(|) }', false)?.signatures[0]?.parameters?.[0]?.label,
    ).toBe('string');
  });

  it('keeps repeated positional labels and optional unions unambiguous', () => {
    const result = help('model Example { value String @repeated("a", |"b") }');
    const signature = result?.signatures[0];
    expect(signature?.label).toBe('@repeated(string, string, (string | boolean)?)');
    expect(result?.activeParameter).toBe(1);
    expect(signature?.parameters).toEqual([
      { label: [10, 16], documentation: markdown('**first**\n\nFirst text.') },
      { label: [18, 24], documentation: markdown('**second**\n\nSecond text.') },
      { label: [26, 45], documentation: markdown('**last**\n\nOptional value.') },
    ]);
  });

  it.each(['flag: |true, value: "a"', 'flag|: true', 'flag: true|', '"a", flag: |'])(
    'matches named arguments by name: %s',
    (args) => {
      expect(field(args)?.activeParameter).toBe(1);
    },
  );

  it.each(['| ', ' |'])('matches the next named argument across comma whitespace: %s', (gap) => {
    expect(
      selected(`model Example {\n value String @probe(flag: true,${gap}collection: [])\n}`),
    ).toEqual({
      label: attributeLabel,
      documentation: markdown('**Extension** attribute.'),
      activeParameter: 3,
      parameter: {
        label: 'collection: nested()[]',
        documentation: markdown('Nested calls in a list.'),
      },
    });
  });

  it.each(['| ', ' |'])('matches a nested named argument across comma whitespace: %s', (gap) => {
    expect(
      selected(`model Example {\n value String @probe(call: nested("a",${gap}flag: true))\n}`),
    ).toEqual({
      label: 'nested(string, flag?: boolean)',
      documentation: markdown('**Nested** function.'),
      activeParameter: 1,
      parameter: { label: 'flag?: boolean', documentation: markdown('Nested flag.') },
    });
  });

  it.each(['| ', ' |'])('suppresses unknown nested calls across comma whitespace: %s', (gap) => {
    expect(field(`call: unknown("a",${gap}flag: true)`)).toBeNull();
  });

  it.each([
    'model Example {\n value String @probe(value: |"a")\n}',
    'model Example {\n value String\n @@probe(value: |"a")\n}',
    'policy Example {\n @@probe(value: |"a")\n}',
  ])('resolves extension contributions: %s', (source) => {
    expect(selected(source)).toEqual({
      label: source.includes('@@probe') ? `@${attributeLabel}` : attributeLabel,
      documentation: markdown(
        source.startsWith('policy')
          ? '**Block** attribute.'
          : source.includes('@@probe')
            ? '**Model** attribute.'
            : '**Extension** attribute.',
      ),
      activeParameter: 0,
      parameter: {
        label: source.includes('@@probe') ? [8, 14] : [7, 13],
        documentation: markdown(
          '**value**\n\nThe named *value*.\n\nAccepted positionally or by `value:`.',
        ),
      },
    });
  });

  it.each([
    'call: nested("a", flag: |true)',
    'collection: [nested("a", flag: |true)]',
    'records: { item: nested("a", flag: |true) }',
  ])('selects the innermost known signature: %s', (args) => {
    expect(selected(`model Example {\n value String @probe(${args})\n}`)).toEqual({
      label: 'nested(string, flag?: boolean)',
      documentation: markdown('**Nested** function.'),
      activeParameter: 1,
      parameter: { label: 'flag?: boolean', documentation: markdown('Nested flag.') },
    });
  });

  it.each([
    'call: unknown(|)',
    'call: nested(unknown(|))',
    'collection: [unknown(|)]',
    'call: unknown(nested(|))',
    'call: other.nested(|)',
  ])('suppresses unknown nested calls rather than falling back: %s', (args) => {
    expect(field(args)).toBeNull();
  });

  it.each([
    'model Example {\n value String @probe(|',
    'model Example {\n value String @probe("a", flag: |',
    'model Example {\n value String @probe(call: nested("a", flag: |',
    'model Example {\n value String @probe(collection: [nested("a", flag: |',
  ])('recovers unfinished argument lists: %s', (source) => {
    const result = selected(source);
    expect(result.label).toBe(
      source.includes('nested(') ? 'nested(string, flag?: boolean)' : attributeLabel,
    );
    expect(result.activeParameter).toBe(source.endsWith('(|') ? 0 : 1);
  });

  it.each(['"a", |', '"a", nested("b")|'])('tracks the second positional parameter: %s', (args) => {
    expect(selected(`model Example {\n value String @pair(${args})\n}`)).toEqual({
      label: '@pair(string, nested())',
      documentation: markdown('Two positional parameters.'),
      activeParameter: 1,
      parameter: { label: [14, 22], documentation: markdown('**call**\n\nSecond parameter.') },
    });
  });

  it('resolves a nested signature from a positional declaration', () => {
    expect(
      selected('model Example {\n value String @pair("a", nested("b", flag: |true))\n}'),
    ).toEqual({
      label: 'nested(string, flag?: boolean)',
      documentation: markdown('**Nested** function.'),
      activeParameter: 1,
      parameter: { label: 'flag?: boolean', documentation: markdown('Nested flag.') },
    });
  });

  it.each([
    { args: 'call|: nested("a")', parameter: 2 },
    { args: 'call: | nested("a")', parameter: 2 },
    { args: 'call|: unknown("a")', parameter: 2 },
    { args: 'collection|: [nested("a")]', parameter: 3 },
    { args: 'collection: | [nested("a")]', parameter: 3 },
    { args: 'records|: { item: nested("a") }', parameter: 4 },
  ])('matches a named parameter before its container value: $args', ({ args, parameter }) => {
    expect(field(args)?.signatures[0]?.label).toBe(attributeLabel);
    expect(field(args)?.activeParameter).toBe(parameter);
  });

  it('selects the innermost of multiple known nested calls', () => {
    expect(
      selected('model Example {\n value String @wrapped(wrap(nested("b", flag: |true)))\n}'),
    ).toEqual({
      label: 'nested(string, flag?: boolean)',
      documentation: markdown('**Nested** function.'),
      activeParameter: 1,
      parameter: { label: 'flag?: boolean', documentation: markdown('Nested flag.') },
    });
  });

  it('returns to the enclosing function rather than the attribute after a nested call closes', () => {
    expect(selected('model Example {\n value String @wrapped(wrap(nested("b")|))\n}')).toEqual({
      label: 'wrap(nested())',
      documentation: markdown('Wraps another call.'),
      activeParameter: 0,
      parameter: { label: [5, 13], documentation: markdown('**inner**\n\nThe wrapped call.') },
    });
  });

  it('selects a matching overload using the active named parameter', () => {
    const result = field('choice: choose(flag: |true)');
    expect(result?.activeSignature).toBe(1);
    expect(result?.activeParameter).toBe(0);
    expect(result?.signatures[1]).toMatchObject({
      label: 'choose(flag: boolean)',
      documentation: markdown('Choose by flag.'),
    });
  });

  it('shows a parameterless nested signature', () => {
    expect(field('empty: empty(|)')?.signatures).toEqual([
      { label: 'empty()', documentation: markdown('No parameters.'), parameters: [] },
    ]);
  });

  it.each([
    { args: 'call: nested("a")|', parameter: 2 },
    { args: 'collection: [nested("a")]|', parameter: 3 },
  ])('returns to the outer parameter after a closed container: $args', ({ args, parameter }) => {
    expect(field(args)?.signatures[0]?.label).toBe(attributeLabel);
    expect(field(args)?.activeParameter).toBe(parameter);
  });

  it.each([
    'model Example {\n value String @probe()|\n}',
    'model Example {\n value String @unknown(|)\n}',
    'model Example {\n value String @probe(call: unknown(|',
    'model Example {\n value String @probe(call: nested(unknown(|',
    'model Example {\n value |String\n}',
    'model Example {\n // @probe(|)\n}',
  ])('suppresses help outside recognized argument lists: %s', (source) => {
    expect(help(source)).toBeNull();
  });

  it('never invokes argument parsers to inspect metadata', () => {
    parseArgument.mockClear();
    expect(field('call: nested(|)')?.signatures[0]?.label).toBe('nested(string, flag?: boolean)');
    expect(parseArgument).not.toHaveBeenCalled();
  });
});
