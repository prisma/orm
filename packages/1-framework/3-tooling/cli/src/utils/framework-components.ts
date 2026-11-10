import type { Contract } from '@internal/contract/types';
import {
  checkContractComponentRequirements,
  type TargetBoundComponentDescriptor,
} from '@internal/framework-components/components';
import type { ControlStack } from '@internal/framework-components/control';
import { errorConfigValidation, errorContractMissingExtensions } from './cli-errors';

/**
 * Asserts that all framework components are compatible with the expected family and target.
 *
 * This function validates that each component in the framework components array:
 * - Has kind 'target', 'adapter', 'extension', or 'driver'
 * - Has familyId matching expectedFamilyId
 * - Has targetId matching expectedTargetId
 *
 * This validation happens at the CLI composition boundary, before passing components
 * to typed planner/runner instances. It fills the gap between runtime validation
 * (the `orm` config schema's diagnostics) and compile-time
 * type enforcement.
 *
 * @param expectedFamilyId - The expected family ID (e.g., 'sql')
 * @param expectedTargetId - The expected target ID (e.g., 'postgres')
 * @param frameworkComponents - Array of framework components to validate
 * @returns The same array typed as TargetBoundComponentDescriptor
 * @throws CliStructuredError if any component is incompatible
 *
 * @example
 * ```ts
 * const configResult = await loadConfigForSections(undefined, ['family', 'target', 'adapter', 'extensions']);
 * const config = configResult.assertOk();
 * const frameworkComponents = [config.target, config.adapter, ...(config.extensions ?? [])];
 *
 * // Validate and type-narrow components before passing to planner
 * const typedComponents = assertFrameworkComponentsCompatible(
 *   config.family.familyId,
 *   config.target.targetId,
 *   frameworkComponents
 * );
 *
 * const planner = target.migrations.createPlanner(familyInstance);
 * planner.plan({ contract, schema, policy, frameworkComponents: typedComponents });
 * ```
 */
export function assertFrameworkComponentsCompatible<
  TFamilyId extends string,
  TTargetId extends string,
>(
  expectedFamilyId: TFamilyId,
  expectedTargetId: TTargetId,
  frameworkComponents: ReadonlyArray<unknown>,
): ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>> {
  for (let i = 0; i < frameworkComponents.length; i++) {
    const component = frameworkComponents[i];

    // Check that component is an object
    if (typeof component !== 'object' || component === null) {
      throw errorConfigValidation('frameworkComponents[]', {
        why: `Framework component at index ${i} must be an object`,
      });
    }

    const record = component as Record<string, unknown>;

    // Check kind
    if (!Object.hasOwn(record, 'kind')) {
      throw errorConfigValidation('frameworkComponents[].kind', {
        why: `Framework component at index ${i} must have 'kind' property`,
      });
    }

    const kind = record['kind'];
    if (kind !== 'target' && kind !== 'adapter' && kind !== 'extension' && kind !== 'driver') {
      throw errorConfigValidation('frameworkComponents[].kind', {
        why: `Framework component at index ${i} has invalid kind '${String(kind)}' (must be 'target', 'adapter', 'extension', or 'driver')`,
      });
    }

    // Check familyId
    if (!Object.hasOwn(record, 'familyId')) {
      throw errorConfigValidation('frameworkComponents[].familyId', {
        why: `Framework component at index ${i} (kind: ${String(kind)}) must have 'familyId' property`,
      });
    }

    const familyId = record['familyId'];
    if (familyId !== expectedFamilyId) {
      throw errorConfigValidation('frameworkComponents[].familyId', {
        why: `Framework component at index ${i} (kind: ${String(kind)}) has familyId '${String(familyId)}' but expected '${expectedFamilyId}'`,
      });
    }

    // Check targetId
    if (!Object.hasOwn(record, 'targetId')) {
      throw errorConfigValidation('frameworkComponents[].targetId', {
        why: `Framework component at index ${i} (kind: ${String(kind)}) must have 'targetId' property`,
      });
    }

    const targetId = record['targetId'];
    if (targetId !== expectedTargetId) {
      throw errorConfigValidation('frameworkComponents[].targetId', {
        why: `Framework component at index ${i} (kind: ${String(kind)}) has targetId '${String(targetId)}' but expected '${expectedTargetId}'`,
      });
    }
  }

  // Type assertion is safe because we've validated all components above
  return frameworkComponents as ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
}

/**
 * Validates that a contract is compatible with the configured target, adapter,
 * and extension packs. Throws on family/target mismatches or missing extension packs.
 *
 * This check ensures the emitted contract matches the CLI config before running
 * commands that depend on the contract (e.g., db verify, db sign).
 *
 * @param contract - The contract to validate (must include targetFamily, target, extensions).
 * @param stack - The control plane stack (target, adapter, driver, extensions).
 *
 * @throws {CliStructuredError} errorConfigValidation when contract.targetFamily or contract.target
 *   doesn't match the configured family/target.
 * @throws {CliStructuredError} errorContractMissingExtensions when the contract requires
 *   extension packs that are not provided in the config (includes all missing packs in error.meta).
 *
 * @example
 * ```ts
 * import { assertContractRequirementsSatisfied } from './framework-components';
 *
 * const config = (await loadConfigForSections(undefined, ['family', 'target', 'adapter', 'extensions', 'contract'])).assertOk();
 * const contract = await loadContractJson(config.contract.output);
 * const stack = createControlStack({ family: config.family, target: config.target, adapter: config.adapter, ... });
 *
 * // Throws if contract is incompatible with config
 * assertContractRequirementsSatisfied({ contract, stack });
 * ```
 */
export function assertContractRequirementsSatisfied<
  TFamilyId extends string,
  TTargetId extends string,
>({
  contract,
  stack,
}: {
  readonly contract: Pick<Contract, 'targetFamily' | 'target' | 'extensions'>;
  readonly stack: ControlStack<TFamilyId, TTargetId>;
}): void {
  const providedComponentIds = new Set<string>([
    stack.target.id,
    ...(stack.adapter ? [stack.adapter.id] : []),
  ]);
  for (const extension of stack.extensions) {
    providedComponentIds.add(extension.id);
  }

  const result = checkContractComponentRequirements({
    contract,
    expectedTargetFamily: stack.target.familyId,
    expectedTargetId: stack.target.targetId,
    providedComponentIds,
  });

  if (result.familyMismatch) {
    throw errorConfigValidation('contract.targetFamily', {
      why: `Contract was emitted for family '${result.familyMismatch.actual}' but CLI config is wired to '${result.familyMismatch.expected}'.`,
    });
  }

  if (result.targetMismatch) {
    throw errorConfigValidation('contract.target', {
      why: `Contract target '${result.targetMismatch.actual}' does not match CLI target '${result.targetMismatch.expected}'.`,
    });
  }

  if (result.missingExtensionPackIds.length > 0) {
    throw errorContractMissingExtensions({
      missingExtensions: result.missingExtensionPackIds,
      providedComponentIds: [...providedComponentIds],
    });
  }
}
