import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import * as refusals from '../../src/core/psl-print/refusals';

const errorReference = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../docs/reference/error-reference.md',
);

/** The cases the error reference lists for `CONTRACT.PRINT_UNSUPPORTED`, one line each. */
function documentedCases(): readonly string[] {
  const text = readFileSync(errorReference, 'utf-8');
  const start = text.indexOf('### CONTRACT.PRINT_UNSUPPORTED\n');
  const end = text.indexOf('\n### ', start + 1);
  return text
    .slice(start, end)
    .split('\n')
    .filter((line) => line.startsWith('  - '));
}

describe('the refusals of contract print', () => {
  it('has one function for each case the error reference lists', () => {
    const functions = Object.entries(refusals).filter(
      ([name, value]) => name.startsWith('refuse') && typeof value === 'function',
    );

    expect(documentedCases().length).toBeGreaterThan(0);
    expect(functions).toHaveLength(documentedCases().length);
  });
});
