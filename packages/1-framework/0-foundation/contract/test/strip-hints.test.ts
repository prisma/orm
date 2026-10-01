import { describe, expect, it } from 'vitest';
import { stripContractHints } from '../src/strip-hints';

describe('stripContractHints', () => {
  it('removes the top-level hints key and keeps every other key', () => {
    const contract = { target: 'postgres', meta: { hints: 'kept' } };
    expect(stripContractHints({ ...contract, hints: { namespaces: {} } })).toEqual(contract);
  });

  it('returns a contract without hints unchanged', () => {
    const contract = { target: 'postgres' };
    expect(stripContractHints(contract)).toEqual(contract);
  });

  it('returns a non-object value unchanged', () => {
    expect(stripContractHints(null)).toBeNull();
  });
});
