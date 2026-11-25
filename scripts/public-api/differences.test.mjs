import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { excerptAround, listDifferences } from './differences.mjs';

const list = (lines) => `# header\n${lines.join('\n')}\n`;

describe('excerptAround', () => {
  it('shows a short line whole', () => {
    strictEqual(excerptAround('.: const a: 1', 5), '.: const a: 1');
  });

  it('shows about 200 characters around the first difference of a long line, and its length', () => {
    const line = `.: const a: ${'x'.repeat(1000)}Y${'z'.repeat(1000)}`;
    const shown = excerptAround(line, line.indexOf('Y'));
    strictEqual(
      shown,
      `…${'x'.repeat(100)}Y${'z'.repeat(99)}… (line of ${line.length} characters, first difference at character ${line.indexOf('Y') + 1})`,
    );
  });

  it('starts a long line with no counterpart at its beginning', () => {
    const line = `.: const a: ${'x'.repeat(500)}`;
    strictEqual(excerptAround(line), `${line.slice(0, 200)}… (line of ${line.length} characters)`);
  });
});

describe('listDifferences', () => {
  it('shows removed and added lines', () => {
    deepStrictEqual(
      listDifferences(
        list(['.: const a: 1', '.: const b: 2']),
        list(['.: const a: 1', '.: const c: 3']),
      ),
      ['- .: const b: 2', '+ .: const c: 3'],
    );
  });

  it('shows a changed long line around where it changed, on both sides', () => {
    const before = `.: const a: ${'x'.repeat(1000)}OLD${'z'.repeat(1000)}`;
    const after = `.: const a: ${'x'.repeat(1000)}NEW${'z'.repeat(1000)}`;
    const at = before.indexOf('OLD');
    deepStrictEqual(listDifferences(list([before]), list([after])), [
      `- ${excerptAround(before, at)}`,
      `+ ${excerptAround(after, at)}`,
    ]);
  });

  it('says how many more lines changed than it shows', () => {
    const many = Array.from({ length: 12 }, (_, index) => `.: const v${index}: ${index}`);
    const shown = listDifferences(list([]), list(many));
    strictEqual(shown.length, 11);
    strictEqual(shown.at(-1), '  ... and 2 more');
  });

  it('reports a file that differs only in order or spacing', () => {
    deepStrictEqual(listDifferences('.: b\n.: a\n', '.: a\n.: b\n'), [
      '  (same lines, different order or spacing)',
    ]);
  });
});
