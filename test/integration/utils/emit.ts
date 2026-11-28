import type { Contract } from '@internal/contract/types';
import { emit as emitImpl } from '@internal/emitter';
import type { ControlStack } from '@internal/framework-components/control';
import type { EmissionSpi } from '@internal/framework-components/emission';
import type { JsonObject } from '@internal/utils/json';
import { workspaceTypesModuleFor } from '@repo/test-utils';

/**
 * Emits as the CLI does: the declarations come from the canonical JSON read
 * back through the stack's own family. Tests that author JSON-clean contracts
 * may keep the default serializer, which writes the contract as it is in
 * format version 1; production callers thread the target descriptor's
 * `contractSerializer.serializeContract` instead.
 */
export function emit(
  contract: Contract,
  stack: ControlStack,
  family: EmissionSpi,
  options: Partial<Omit<Parameters<typeof emitImpl>[3], 'deserializeContract'>> = {},
): ReturnType<typeof emitImpl> {
  const familyInstance = stack.family.create(stack);
  return emitImpl(contract, stack, family, {
    serializeContract: (c) => ({ formatVersion: 1, ...(c as unknown as JsonObject) }),
    typesModule: workspaceTypesModuleFor(stack.target.targetId),
    ...options,
    deserializeContract: (json) => familyInstance.deserializeContract(json),
  });
}
