import { bool, funcCall, list, optional, str } from '@internal/psl-parser';
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
  const first = '$' + '{1:}';
  const second = '$' + '{2:}';
  expect(requiredArgumentsSnippet(call.signature)).toBe(`"${first}", flags: [${second}]`);
});
