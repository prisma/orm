import type { Contract } from '@internal/contract/types';
import { createSqlContract } from '@repo/test-utils';
import type { SqlStorage } from '../src/types';
import { validateSqlContractFully } from '../src/validators';

const column = { nativeType: 'text', codecId: 'pg/text@1', nullable: false };

function sqlTable(...columnNames: string[]) {
  return {
    columns: Object.fromEntries(columnNames.map((name) => [name, column])),
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

function contractJsonWithHints(hints: unknown): Record<string, unknown> {
  return {
    ...createSqlContract({
      tables: {
        public: {
          User: sqlTable('id', 'firstName', 'givenName', 'email'),
          Post: sqlTable('id'),
          Account: sqlTable('id'),
        },
      },
    }),
    hints,
  };
}

export function loadContract(hints: unknown): Contract<SqlStorage> {
  return validateSqlContractFully<Contract<SqlStorage>>(contractJsonWithHints(hints));
}

export const exampleHints = {
  namespaces: {
    public: {
      tables: {
        Account: { was: 'Customer' },
        User: { was: 'Profile' },
      },
    },
  },
};

export function tableHints(tables: Record<string, unknown>, namespace = 'public') {
  return { namespaces: { [namespace]: { tables } } };
}
