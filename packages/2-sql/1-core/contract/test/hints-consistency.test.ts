import type { Contract } from '@internal/contract/types';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { assertContractHintsConsistent } from '../src/hints';
import type { SqlStorage } from '../src/types';
import { validateSqlContractFully } from '../src/validators';
import { exampleHints, loadContract, tableHints } from './hints-fixtures';

describe('assertContractHintsConsistent', () => {
  function expectHintInvalid(hints: unknown, message: string) {
    expect(() => assertContractHintsConsistent(loadContract(hints))).toThrow(
      expect.objectContaining({ code: 'CONTRACT.HINT_INVALID', message }),
    );
  }

  it('passes for a consistent contract', () => {
    expect(() => assertContractHintsConsistent(loadContract(exampleHints))).not.toThrow();
  });

  it('passes for a contract without hints', () => {
    const contract = validateSqlContractFully<Contract<SqlStorage>>(createSqlContract());
    expect(() => assertContractHintsConsistent(contract)).not.toThrow();
  });

  describe('namespaces', () => {
    it('rejects a renamed table in a namespace the contract does not declare', () => {
      expectHintInvalid(
        tableHints({ User: { was: 'Profile' } }, 'ghost'),
        'Contract hints: table "User" names namespace "ghost", which the contract does not declare.',
      );
    });
  });

  describe('hinted tables exist', () => {
    it('rejects a rename hint on a table the contract does not declare', () => {
      expectHintInvalid(
        tableHints({ Customer: { was: 'Client' } }),
        'Contract hints: table "Customer" carries a hint but the contract does not declare it.',
      );
    });
  });

  describe('old names are free and unique', () => {
    it('rejects a table was naming a table the contract declares', () => {
      expectHintInvalid(
        tableHints({ User: { was: 'Post' } }),
        'Contract hints: table "User" claims it was "Post", which the contract also declares.',
      );
    });

    it('rejects two tables claiming the same was', () => {
      expectHintInvalid(
        tableHints({ User: { was: 'Profile' }, Account: { was: 'Profile' } }),
        'Contract hints: table "Account" and "User" both claim they were "Profile".',
      );
    });
  });
});
