import type { PrismaNextConfig } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import {
  type ControlFamilyInstance,
  hasAuthoredContractValidation,
} from '@internal/framework-components/control';
import { assertFrameworkComponentsCompatible } from '../../utils/framework-components';
import { enrichContract } from '../contract-enrichment';

/**
 * Validates a contract its source loaded, as `contract emit` and `contract print` both do before
 * they write anything: the contract is enriched with what the configured components declare,
 * serialized by the target, and read back through the family instance, which checks its structure.
 * A family that checks authored-contract rules the serializer leaves alone then checks those too.
 * Returns the contract that comes back.
 *
 * @throws {CliStructuredError} when a configured component does not match the family and target
 * @throws the family instance's error for a contract whose structure or authored rules it rejects
 */
export function validateLoadedContract(input: {
  readonly config: PrismaNextConfig;
  readonly familyInstance: ControlFamilyInstance<string, unknown>;
  readonly contract: Contract;
}): Contract {
  const { config } = input;
  const frameworkComponents = assertFrameworkComponentsCompatible(
    config.family.familyId,
    config.target.targetId,
    [config.target, config.adapter, ...(config.extensions ?? [])],
  );
  const enriched = enrichContract(input.contract, frameworkComponents);
  const { familyInstance } = input;
  const deserialized = familyInstance.deserializeContract(
    config.target.contractSerializer.serializeContract(enriched),
  );
  if (hasAuthoredContractValidation(familyInstance)) {
    familyInstance.validateAuthoredContract(deserialized);
  }
  return deserialized;
}
