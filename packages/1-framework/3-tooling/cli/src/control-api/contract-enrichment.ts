import type { Contract } from '@internal/contract/types';
import {
  mergeCapabilityMatrices,
  type TargetBoundComponentDescriptor,
} from '@internal/framework-components/components';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  const next: Record<string, unknown> = {};
  for (const [key, child] of entries) {
    next[key] = sortDeep(child);
  }
  return next;
}

function sortDeepTyped<T>(value: T): T {
  return sortDeep(value) as T;
}

/**
 * The keys of a pack's `types` metadata that a contract carries, each with the members it leaves out. The left-out members are the type-import declarations, which only the emitter reads and reads from the descriptor, and the codec members that hold functions. Any key not listed stays out of the contract, such as the `storage` list that a pack built for an earlier framework still declares.
 */
const CONTRACT_TYPES_OMITTED_MEMBERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['aggregateDescriptors', new Set<string>()],
  [
    'codecTypes',
    new Set([
      'import',
      'typeImports',
      'parameterizedOutputTypes',
      'controlPlaneHooks',
      'codecDescriptors',
    ]),
  ],
  ['operationTypes', new Set(['import'])],
  ['queryOperationTypes', new Set(['import'])],
]);

function contractTypesEntry(key: string, value: unknown): [string, unknown] | undefined {
  const omitted = CONTRACT_TYPES_OMITTED_MEMBERS.get(key);
  if (omitted === undefined) return undefined;
  if (!isPlainObject(value)) return [key, value];
  const kept = Object.entries(value).filter(([member]) => !omitted.has(member));
  return kept.length > 0 ? [key, Object.fromEntries(kept)] : undefined;
}

function extractExtensionPackMeta(
  component: TargetBoundComponentDescriptor<string, string>,
): Record<string, unknown> {
  const { kind, id, version, capabilities, types } = component;
  const base: Record<string, unknown> = {
    kind,
    id,
    familyId: component.familyId,
    targetId: component.targetId,
    version,
  };
  if (capabilities) {
    base['capabilities'] = capabilities;
  }
  const carried = Object.entries(types ?? {}).flatMap(([key, value]) => {
    const entry = contractTypesEntry(key, value);
    return entry === undefined ? [] : [entry];
  });
  if (carried.length > 0) {
    base['types'] = Object.fromEntries(carried);
  }
  return base;
}

/**
 * Enriches a raw contract with framework-derived metadata: capabilities from all component descriptors and extension pack metadata from extension descriptors. Produces deterministically sorted output.
 */
export function enrichContract(
  ir: Contract,
  components: ReadonlyArray<TargetBoundComponentDescriptor<string, string>>,
): Contract {
  const mergedCapabilities = mergeCapabilityMatrices(ir.capabilities, components);

  const extensionsMeta: Record<string, unknown> = {};
  for (const component of components) {
    if (component.kind === 'extension') {
      extensionsMeta[component.id] = extractExtensionPackMeta(component);
    }
  }

  const extensions =
    Object.keys(extensionsMeta).length > 0
      ? { ...ir.extensions, ...extensionsMeta }
      : ir.extensions;

  return {
    ...ir,
    capabilities: sortDeepTyped(mergedCapabilities),
    extensions: sortDeepTyped(extensions),
  };
}
