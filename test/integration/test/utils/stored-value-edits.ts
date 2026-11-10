import { expect } from 'vitest';

/** One call of `name` in `source` from its start, written on one line with double quotes and no trailing commas. */
function oneLineCalls(source: string, name: string): string {
  let out = '';
  let rest = source;
  for (;;) {
    const start = rest.indexOf(`this.${name}({`);
    if (start === -1) return out + rest;
    let depth = 0;
    let end = start;
    for (let i = start; i < rest.length; i += 1) {
      if (rest[i] === '(') depth += 1;
      if (rest[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    const call = rest
      .slice(start, end)
      .replace(/'/g, '"')
      .replace(/,\s*}/g, ' }')
      .replace(/\s+/g, ' ')
      .replace(/\{ /g, '{ ')
      .replace(/\( /g, '(');
    out += rest.slice(0, start) + call;
    rest = rest.slice(end);
  }
}

/**
 * Makes each edit the advice prints, as printed, in the formatted `source`: a `Replace:` block quotes
 * the calls exactly as the file holds them, and a `replace <call> with <call>` phrase quotes them on
 * one line.
 */
export function followEdits(source: string, advice: string): string {
  const blocks = [
    ...advice.matchAll(
      /Replace:\n(this\.removeStoredValue\(\{[\s\S]*?\n\s*\}\))\nwith:\n(this\.replaceStoredValue\(\{[\s\S]*?\n\s*\}\)(?:,\n\s*this\.replaceStoredValue\(\{[\s\S]*?\n\s*\}\))*)(?=\nReplace:|$)/g,
    ),
  ];
  const phrases = [
    ...advice.matchAll(
      /replace (this\.removeStoredValue\(\{.*?\}\)) with (this\.replaceStoredValue\(\{.*?\}\)(?:, this\.replaceStoredValue\(\{.*?\}\))*)/g,
    ),
  ];
  expect(blocks.length + phrases.length, 'the advice prints an edit').toBeGreaterThan(0);
  let edited = source;
  for (const [, remove = '', replaceWith = ''] of blocks) {
    expect(edited, 'the file holds the call as the advice quotes it').toContain(remove);
    edited = edited.replace(remove, replaceWith);
  }
  if (phrases.length === 0) return edited;
  edited = oneLineCalls(edited, 'removeStoredValue');
  for (const [, remove = '', replaceWith = ''] of phrases) {
    expect(edited, 'the file holds the call the advice names').toContain(remove);
    edited = edited.replace(remove, replaceWith);
  }
  return edited;
}
