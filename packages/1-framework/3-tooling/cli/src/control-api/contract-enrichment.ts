import { computeProfileHash } from '@internal/contract/hashing';
import { compareCodeUnits } from '@internal/contract/hashing-utils';
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
  const entries = Object.entries(value).sort(([a], [b]) => compareCodeUnits(a, b));
  const next: Record<string, unknown> = {};
  for (const [key, child] of entries) {
    next[key] = sortDeep(child);
  }
  return next;
}

function sortDeepTyped<T>(value: T): T {
  return sortDeep(value) as T;
}

function enabledCapabilities(
  matrix: Record<string, Record<string, boolean>>,
): Record<string, Record<string, boolean>> {
  return Object.fromEntries(
    Object.entries(matrix).flatMap(([namespace, flags]) => {
      const enabled = Object.entries(flags).filter(([, flag]) => flag);
      return enabled.length > 0 ? [[namespace, Object.fromEntries(enabled)]] : [];
    }),
  );
}

const TYPE_IMPORT_MEMBERS_THE_EMITTER_READS_FROM_THE_DESCRIPTOR = [
  'import',
  'typeImports',
  'parameterizedOutputTypes',
];
const CODEC_MEMBERS_HOLDING_FUNCTIONS = ['controlPlaneHooks', 'codecDescriptors'];

const CONTRACT_TYPES_KEYS_WITH_OMITTED_MEMBERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['aggregateDescriptors', new Set<string>()],
  [
    'codecTypes',
    new Set([
      ...TYPE_IMPORT_MEMBERS_THE_EMITTER_READS_FROM_THE_DESCRIPTOR,
      ...CODEC_MEMBERS_HOLDING_FUNCTIONS,
    ]),
  ],
  ['operationTypes', new Set(['import'])],
  ['queryOperationTypes', new Set(['import'])],
]);

function contractTypesEntry(key: string, value: unknown): [string, unknown] | undefined {
  const omitted = CONTRACT_TYPES_KEYS_WITH_OMITTED_MEMBERS.get(key);
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
  if (capabilities && Object.keys(capabilities).length > 0) {
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
 * Enriches a raw contract with framework-derived metadata: the enabled capabilities of all component descriptors, the profile hash of those capabilities, and extension pack metadata from extension descriptors. Produces deterministically sorted output.
 */
export function enrichContract(
  ir: Contract,
  components: ReadonlyArray<TargetBoundComponentDescriptor<string, string>>,
): Contract {
  const capabilities = sortDeepTyped(
    enabledCapabilities(mergeCapabilityMatrices(ir.capabilities, components)),
  );

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
    capabilities,
    profileHash: computeProfileHash({
      target: ir.target,
      targetFamily: ir.targetFamily,
      capabilities,
    }),
    extensions: sortDeepTyped(extensions),
  };
}
