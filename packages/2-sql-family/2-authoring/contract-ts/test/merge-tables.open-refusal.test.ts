import { describe, expect, it, vi } from 'vitest';
import { mergeTables } from '../src/merge-tables';
import type * as SharedTableConstraints from '../src/shared-table-constraints';
import { baseTable, column, ownTable, table } from './merge-tables-support';

vi.mock('../src/shared-table-constraints', async (importOriginal) => {
  const original = await importOriginal<typeof SharedTableConstraints>();
  return {
    ...original,
    mergeSharedTable: (input: Parameters<typeof original.mergeSharedTable>[0]) => ({
      ...original.mergeSharedTable(input),
      refusals: [{ kind: '%future added value', variant: 'Bug' }],
    }),
  };
});

describe('mergeTables on a shared-table refusal of a kind a later release adds', () => {
  it('treats it as a bug of the release', () => {
    const task = table('task', [column('Task', 'id'), column('Task', 'ownerId')]);
    expect(() =>
      mergeTables([ownTable(task), baseTable('Bug', 'task', [column('Bug', 'ownerId')], {})], []),
    ).toThrow(/words every shared-table refusal of its own release/);
  });
});
