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
  it('words it by the variant and the kind', () => {
    const task = table('task', [column('Task', 'id'), column('Task', 'ownerId')]);
    expect(() =>
      mergeTables([ownTable(task), baseTable('Bug', 'task', [column('Bug', 'ownerId')], {})], []),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message:
          'Model "Bug" shares table "task" with other models (single-table inheritance), and what it declares there is refused for a reason this version does not name ("%future added value").',
      }),
    );
  });
});
