import { bool, funcCall, list, optional, record, str } from '@internal/psl-parser';
import { expect, it } from 'vitest';
import { requiredArgumentsSnippet } from '../src/completion-snippets';

it('unwraps documented named parameters and preserves optionality and positional aliases', () => {
  const text = str();
  const call = funcCall('format', {
    documentation: 'Formats text with required flags.',
    positional: [{ key: 'text', type: text, documentation: 'The input text.' }],
    named: {
      text: { type: text, documentation: 'The input text supplied by name.' },
      flags: { type: list(bool()), documentation: 'Formatting flags.' },
      enabled: { type: optional(bool(), true), documentation: 'Enables formatting by default.' },
    },
  });
  const first = '$' + '{1:text}';
  const second = '$' + '{2:flags}';
  expect(requiredArgumentsSnippet(call.signature)).toBe(`"${first}", flags: [${second}]`);
});

const valuePlaceholder = '$' + '{1:value}';
const optionPlaceholder = '$' + '{2:option}';

it.each([
  { type: str(), expected: `"${valuePlaceholder}", option: "${optionPlaceholder}"` },
  { type: list(str()), expected: `[${valuePlaceholder}], option: [${optionPlaceholder}]` },
  { type: record(str()), expected: `{ ${valuePlaceholder} }, option: { ${optionPlaceholder} }` },
  { type: bool(), expected: `${valuePlaceholder}, option: ${optionPlaceholder}` },
])('uses argument names as defaults for $type.kind parameters', ({ type, expected }) => {
  expect(
    requiredArgumentsSnippet({
      positional: [{ key: 'value', type, documentation: 'Input value.' }],
      named: { option: { type, documentation: 'Required option.' } },
    }),
  ).toBe(expected);
});

it('skips optional positional and named parameters without consuming tab stops', () => {
  expect(
    requiredArgumentsSnippet({
      positional: [
        { key: 'optionalValue', type: optional(str()), documentation: 'Optional input.' },
        { key: 'value', type: bool(), documentation: 'Required input.' },
      ],
      named: {
        optionalOption: { type: optional(str()), documentation: 'Optional option.' },
        option: { type: bool(), documentation: 'Required option.' },
      },
    }),
  ).toBe(`${valuePlaceholder}, option: ${optionPlaceholder}`);
});

it('returns an empty snippet without required arguments', () => {
  expect(requiredArgumentsSnippet({})).toBe('');
});
