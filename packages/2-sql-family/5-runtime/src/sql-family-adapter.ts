import type { Contract } from '@internal/contract/types';
import type { ExecutionPlan, QueryPlan } from '@internal/framework-components/runtime';
import { runtimeError } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { AdapterProfile } from '@internal/sql-relational-core/ast';
import type { MarkerReader, RuntimeFamilyAdapter } from './runtime-spi';

export class SqlFamilyAdapter<TContract extends Contract<SqlStorage>>
  implements RuntimeFamilyAdapter<TContract>
{
  readonly contract: TContract;
  readonly markerReader: MarkerReader;

  constructor(contract: TContract, adapterProfile: AdapterProfile) {
    this.contract = contract;
    this.markerReader = adapterProfile;
  }

  validatePlan(plan: ExecutionPlan, contract: TContract): void {
    validateSqlPlan(plan, contract);
  }
}

/** Rejects a plan built for another target or contract: `PLAN.TARGET_MISMATCH` or `PLAN.HASH_MISMATCH`. */
export function validateSqlPlan(plan: QueryPlan, contract: Contract<SqlStorage>): void {
  if (plan.meta.target !== contract.target) {
    throw runtimeError(
      'PLAN.TARGET_MISMATCH',
      'The plan was built for another target than the contract',
      { planTarget: plan.meta.target, contractTarget: contract.target },
    );
  }

  if (plan.meta.storageHash !== contract.storage.storageHash) {
    throw runtimeError('PLAN.HASH_MISMATCH', 'The plan was built for another contract', {
      planStorageHash: plan.meta.storageHash,
      contractStorageHash: contract.storage.storageHash,
    });
  }
}
