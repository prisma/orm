import { ContractValidationError } from '@internal/contract/contract-validation-error';
import { errorContractDeserializationFailed } from '@internal/migration-tools/errors';
import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { mapContractAtError } from '../../src/control-api/operations/contract-at-errors';
import { contractValidationMeta } from '../../src/utils/contract-validation-meta';

const refusedDefaults = [{ namespaceId: 'public', table: 'Token', column: 'value' }];
const refused = () => new ContractValidationError('refused', 'storage', { refusedDefaults });

describe('contractValidationMeta', () => {
  it('gives the meta of a contract the family refused to load', () => {
    expect(contractValidationMeta(refused())).toEqual({ refusedDefaults });
  });

  it('gives the refused defaults a snapshot that failed to load kept', () => {
    const snapshot = errorContractDeserializationFailed('/m/snapshots/x/contract.json', 'refused', {
      cause: refused(),
    });
    expect(contractValidationMeta(snapshot)).toEqual({ refusedDefaults });
  });

  it('gives nothing for another error', () => {
    expect({
      other: contractValidationMeta(structuredError('CONTRACT.DEFAULT_INVALID', 'x', { meta: {} })),
      plain: contractValidationMeta(new Error('x')),
    }).toEqual({ other: undefined, plain: undefined });
  });
});

describe('mapContractAtError on a snapshot the family refused', () => {
  it('reports the contract validation failure with the refused defaults', () => {
    const mapped = mapContractAtError(
      errorContractDeserializationFailed('/m/snapshots/x/contract.json', 'refused', {
        cause: refused(),
      }),
    );
    expect(mapped.ok ? undefined : mapped.failure).toMatchObject({
      code: 'CONTRACT.VALIDATION_FAILED',
      meta: { refusedDefaults },
    });
  });
});
