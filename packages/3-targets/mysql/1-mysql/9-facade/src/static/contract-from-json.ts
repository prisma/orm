import type { Contract } from '@internal/contract/types';
import { validateContractOnce } from '@internal/contract/validate-once';
import type { SqlStorage } from '@internal/sql-contract/types';
import mysqlTarget, { MysqlContractSerializer } from '@internal/target-mysql/runtime';
import { version } from '../../package.json' with { type: 'json' };

const serializer = new MysqlContractSerializer();
const validator = `${mysqlTarget.targetId}@${version}`;

/**
 * Validates an emitted MySQL `contract.json` and returns it as the contract type the application
 * names, ready to pass to `mysql({ contract })` and `mysqlStatic({ contract })`. Clients built
 * from the result do not validate it again.
 *
 * The returned value's top level is frozen; its nested objects are not. Do not change `json` or the
 * returned value after the call: clients built from the value later do not validate it again.
 *
 * @example
 * ```ts
 * import type { Contract } from './contract.d';
 * import contractJson from './contract.json' with { type: 'json' };
 *
 * export const contract = contractFromJson<Contract>(contractJson);
 * ```
 */
export function contractFromJson<TContract extends Contract<SqlStorage>>(json: unknown): TContract {
  return validateContractOnce(json, validator, (input) =>
    serializer.deserializeContract<TContract>(input),
  );
}

export function validateMysqlContract<TContract extends Contract<SqlStorage>>(
  contract: TContract,
): TContract {
  return validateContractOnce(contract, validator, () =>
    serializer.deserializeContract<TContract>(serializer.serializeContract(contract)),
  );
}
