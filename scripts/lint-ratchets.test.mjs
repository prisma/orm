import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { compareDiagnostics, inferScopeCount, sitesForScope } from './lint-ratchets.mjs';

const diagnostic = (message, path, line) => ({
  category: 'plugin',
  message,
  location: { path, start: { line } },
});

describe('compareDiagnostics', () => {
  test('reports the count delta and added sites', () => {
    const base = [diagnostic('no-bare-cast: x', 'src/a.ts', 1)];
    const head = [
      ...base,
      diagnostic('no-bare-cast: x', 'src/b.ts', 2),
      diagnostic('no-bare-throw: x', 'src/c.ts', 3),
    ];
    const filter = (diagnostics) =>
      diagnostics.filter((entry) => entry.message.startsWith('no-bare-cast:'));

    assert.deepEqual(compareDiagnostics(head, base, filter), {
      current: 2,
      baseline: 1,
      delta: 1,
      added: ['src/b.ts:2'],
    });
  });
});

describe('sitesForScope', () => {
  test('deduplicates lines and restricts diagnostics to the configured scope', () => {
    const diagnostics = [
      diagnostic('no-family-vocabulary: x', 'packages/1-framework/src/a.ts', 4),
      diagnostic('no-family-vocabulary: x', 'packages/1-framework/src/a.ts', 4),
      diagnostic('no-family-vocabulary: x', 'packages/2-sql/src/a.ts', 4),
      diagnostic('no-bare-cast: x', 'packages/1-framework/src/b.ts', 5),
    ];

    assert.deepEqual(sitesForScope(diagnostics, 'packages/1-framework'), [
      'packages/1-framework/src/a.ts:4',
    ]);
  });
});

describe('inferScopeCount', () => {
  test('applies the changed-file diagnostic delta to the merge-base threshold', () => {
    const base = [diagnostic('no-family-vocabulary: x', 'packages/1-framework/src/a.ts', 1)];
    const head = [
      diagnostic('no-family-vocabulary: x', 'packages/1-framework/src/a.ts', 1),
      diagnostic('no-family-vocabulary: x', 'packages/1-framework/src/b.ts', 2),
    ];

    assert.equal(inferScopeCount(310, head, base, 'packages/1-framework'), 311);
  });
});
