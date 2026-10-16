import { blindCast } from '@internal/utils/casts';

interface ValidatedContract {
  readonly validator: string;
  readonly contract: object;
}

const validatedContractsKey = Symbol.for('prisma.orm.validatedContracts');

function validatedContracts(): WeakMap<object, ValidatedContract> {
  const existing: unknown = Reflect.get(globalThis, validatedContractsKey);
  if (existing instanceof WeakMap) {
    return existing;
  }
  const created = new WeakMap<object, ValidatedContract>();
  Object.defineProperty(globalThis, validatedContractsKey, { value: created });
  return created;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/**
 * Runs `validate` on `input` unless `validator` already validated `input`, or `input` is a result
 * of that validation. The record is kept on `globalThis` under a `Symbol.for` key, so separate
 * bundles and copies of the code in one program share it; `validator` names the validation rules,
 * including the version that owns them, so another version validates again.
 *
 * The returned contract's top level is frozen; its nested objects are not. The input is not frozen,
 * because it belongs to the caller. Neither may be changed after the call: a later call returns the
 * recorded contract without validating again.
 */
export function validateContractOnce<TContract extends object>(
  input: unknown,
  validator: string,
  validate: (input: unknown) => TContract,
): TContract {
  const registry = validatedContracts();
  if (isObject(input)) {
    const recorded = registry.get(input);
    if (recorded !== undefined && recorded.validator === validator) {
      return blindCast<
        TContract,
        'the record for this validator holds the contract its validate function returned'
      >(recorded.contract);
    }
  }
  const contract = Object.freeze(validate(input));
  const record: ValidatedContract = { validator, contract };
  registry.set(contract, record);
  if (isObject(input)) {
    registry.set(input, record);
  }
  return contract;
}
