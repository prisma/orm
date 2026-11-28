import type * as ContractBuilder from '@internal/sql-contract-ts/contract-builder';
import { describe, expect, it, vi } from 'vitest';
import { actor, contact, diagnosticsOf, humanWithContact } from './sti-variant-support';

vi.mock('@internal/sql-contract-ts/contract-builder', async (importOriginal) => {
  const original = await importOriginal<typeof ContractBuilder>();
  return {
    ...original,
    mergeSharedTable: (input: Parameters<typeof original.mergeSharedTable>[0]) => ({
      ...original.mergeSharedTable(input),
      refusals: [{ kind: '%future added value', variant: 'HumanActor' }],
    }),
  };
});

describe('a shared-table refusal of a kind a later release adds', () => {
  it('is worded by the variant and the kind', () => {
    expect(diagnosticsOf([contact, actor, humanWithContact('')].join('\n\n'))).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_DECLARATION',
        message:
          'Model "HumanActor" shares the table of its base model "Actor" (single-table inheritance), and what it declares there is refused for a reason this version does not name ("%future added value").',
      }),
    ]);
  });
});
