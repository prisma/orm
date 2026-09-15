import { ContractValidationError } from '@internal/contract/contract-validation-error';
import type { ContractModel, ExecutionMutationDefault } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { blindCast } from '@internal/utils/casts';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { col, model, table } from '../src/factories';
import { StorageColumn } from '../src/ir/storage-column';
import type { SqlStorage } from '../src/types';
import { validateSqlContractFully } from '../src/validators';

const instantNow = { kind: 'generator', id: 'instantNow' } as const;

function readingContract(updatedAt: StorageColumn, defaults: readonly ExecutionMutationDefault[]) {
  return createContract<SqlStorage>({
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          kind: 'test-sql-namespace',
          entries: {
            table: { reading: table({ id: col('int4', 'pg/int4@1'), updatedAt }) },
          },
        },
      },
    },
    models: {
      Reading: blindCast<ContractModel, 'model() widens relations; none are declared here'>(
        model('reading', { id: { column: 'id' }, updatedAt: { column: 'updatedAt' } }),
      ),
    },
    execution: { mutations: { defaults } },
  });
}

const updatedAtRef = { namespace: UNBOUND_NAMESPACE_ID, table: 'reading', column: 'updatedAt' };

describe('validateSqlContractFully and execution defaults', () => {
  it('accepts a column with a storage default and generators on create and update', () => {
    const column = new StorageColumn({
      nativeType: 'timestamp',
      codecId: 'pg/timestamp-temporal@1',
      nullable: false,
      default: { kind: 'function', expression: 'now()' },
    });
    const defaults = [{ ref: updatedAtRef, onCreate: instantNow, onUpdate: instantNow }];

    const validated = validateSqlContractFully(readingContract(column, defaults));

    const reading = validated.storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries.table?.['reading'];
    expect(validated.execution?.mutations.defaults).toEqual(defaults);
    expect(reading?.columns['updatedAt']?.default).toEqual({
      kind: 'function',
      expression: 'now()',
    });
  });

  it('accepts generators on create and update for a nullable column', () => {
    const column = col('timestamp', 'pg/timestamp-temporal@1', true);
    const defaults = [{ ref: updatedAtRef, onCreate: instantNow, onUpdate: instantNow }];

    const validated = validateSqlContractFully(readingContract(column, defaults));

    expect(validated.execution?.mutations.defaults).toEqual(defaults);
  });

  it('rejects a generator whose kind is not "generator", so the section is checked rather than ignored', () => {
    const column = col('timestamp', 'pg/timestamp-temporal@1', true);
    const defaults = [
      blindCast<ExecutionMutationDefault, 'deliberately malformed generator kind'>({
        ref: updatedAtRef,
        onCreate: { kind: 'sequence', id: 'instantNow' },
      }),
    ];

    expect(() => validateSqlContractFully(readingContract(column, defaults))).toThrow(
      ContractValidationError,
    );
  });
});
