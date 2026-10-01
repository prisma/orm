import { ContractValidationError } from '@internal/contract/contract-validation-error';
import type { Contract } from '@internal/contract/types';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { sqlContractHints } from '../src/hints';
import type { SqlStorage } from '../src/types';
import { validateSqlContractFully } from '../src/validators';
import { exampleHints, loadContract, tableHints } from './hints-fixtures';

describe('hints section validation', () => {
  it('accepts the full section and keeps it on the loaded contract', () => {
    expect(loadContract(exampleHints).hints).toEqual(exampleHints);
  });

  it.each([
    ['an unknown top-level key', { ...exampleHints, extra: true }],
    ['an unknown namespace key', { namespaces: { public: { tables: {}, views: {} } } }],
    ['an unknown table entry key', tableHints({ User: { was: 'Profile', renamed: true } })],
    ['an empty table was', tableHints({ User: { was: '' } })],
    ['an empty table entry', tableHints({ User: {} })],
    [
      'a deleted table entry, which no planner acts on yet',
      tableHints({ Legacy: { deleted: true } }),
    ],
    [
      'a deleted table entry with a control policy',
      tableHints({ Legacy: { deleted: true, control: 'tolerated' } }),
    ],
    [
      'a column entry, which no planner acts on yet',
      tableHints({ User: { columns: { firstName: { was: 'first_name' } } } }),
    ],
    [
      'column entries beside a table was',
      tableHints({ User: { was: 'Profile', columns: { firstName: { was: 'first_name' } } } }),
    ],
    ['control on a was entry', tableHints({ User: { was: 'Profile', control: 'external' } })],
    ['a namespaces map that is not an object', { namespaces: 'public' }],
  ])('rejects %s', (_label, hints) => {
    expect(() => loadContract(hints)).toThrow(ContractValidationError);
    expect(() => loadContract(hints)).toThrow(/hints/);
  });
});

describe('sqlContractHints', () => {
  it('returns the section of a loaded contract', () => {
    expect(sqlContractHints(loadContract(exampleHints))).toEqual(exampleHints);
  });

  it('returns undefined for a contract without hints', () => {
    const contract = validateSqlContractFully<Contract<SqlStorage>>(createSqlContract());
    expect(sqlContractHints(contract)).toBeUndefined();
  });
});
