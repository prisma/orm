import type { Contract, ControlPolicy } from '@internal/contract/types';
import { effectiveControlPolicy } from '@internal/contract/types';
import { elementCoordinates, entityAt } from '@internal/framework-components/ir';
import { blindCast } from '@internal/utils/casts';

function isControlPolicy(value: unknown): value is ControlPolicy {
  return (
    value === 'managed' || value === 'tolerated' || value === 'external' || value === 'observed'
  );
}

/**
 * True when every storage element the contract declares resolves to the
 * `external` control policy (ADR 224) — element-level `control` first, the
 * contract's `defaultControlPolicy` otherwise. A contract with no storage
 * elements is vacuously all-external.
 *
 * This is the precondition for advancing a contract space's marker without
 * any migrations (the declared-state resolution the db-init aggregate
 * planner and `migrate` share): only when nothing in the space is
 * Prisma 8-managed can the storage structure be correct without a
 * migration having produced it. Any space that declares a managed element
 * but ships no migration graph is an authoring bug and must fail loudly.
 */
export function allStorageElementsExternal(contract: Contract): boolean {
  for (const coordinate of elementCoordinates(contract.storage)) {
    const entity = entityAt(contract.storage, coordinate);
    const declared =
      entity !== null && typeof entity === 'object'
        ? blindCast<
            { readonly control?: unknown },
            'structural read of the optional control field'
          >(entity).control
        : undefined;
    const policy = effectiveControlPolicy(
      isControlPolicy(declared) ? declared : undefined,
      contract.defaultControlPolicy,
    );
    if (policy !== 'external') return false;
  }
  return true;
}
