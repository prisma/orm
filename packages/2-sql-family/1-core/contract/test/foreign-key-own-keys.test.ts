import { ContractValidationError } from '@internal/contract/contract-validation-error';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { validateSqlContractFully } from '../src/validators';

function contractReferencing(tableName: string) {
  return createContract({
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              post: {
                columns: {
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  author_id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: UNBOUND_NAMESPACE_ID,
                      tableName: 'post',
                      columns: ['author_id'],
                    },
                    target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName, columns: ['id'] },
                  },
                ],
              },
            },
          },
        },
      },
    },
  });
}

describe('a foreign key to a missing table named like a property every object has', () => {
  it.each(['ghost', 'toString', 'constructor'])('is refused for table "%s"', (tableName) => {
    expect(() => validateSqlContractFully(contractReferencing(tableName))).toThrow(
      new ContractValidationError(
        `Namespace "${UNBOUND_NAMESPACE_ID}" table "post" foreignKey references non-existent table "${UNBOUND_NAMESPACE_ID}.${tableName}"`,
        'storage',
      ),
    );
  });
});
