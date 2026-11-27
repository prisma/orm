import type { Contract } from '@internal/contract/types';
import { emit as emitImpl } from '@internal/emitter';
import type { ControlStack } from '@internal/framework-components/control';
import type { EmissionSpi } from '@internal/framework-components/emission';
import { workspaceTypesModuleFor } from '@repo/test-utils';

/**
 * Emits as the CLI does: the contract is written by the stack's target serializer, and the declarations come from the canonical JSON read back through the stack's own family.
 */
export function emit(
  contract: Contract,
  stack: ControlStack,
  family: EmissionSpi,
  options: Partial<Omit<Parameters<typeof emitImpl>[3], 'deserializeContract'>> = {},
): ReturnType<typeof emitImpl> {
  const familyInstance = stack.family.create(stack);
  return emitImpl(contract, stack, family, {
    serializeContract: (c) => stack.target.contractSerializer.serializeContract(c),
    typesModule: workspaceTypesModuleFor(stack.target.targetId),
    ...options,
    deserializeContract: (json) => familyInstance.deserializeContract(json),
  });
}
