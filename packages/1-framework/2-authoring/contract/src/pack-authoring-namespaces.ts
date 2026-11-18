import {
  AUTHORING_TYPE_DESCRIPTOR_KINDS,
  type AuthoringDescriptorKinds,
  type AuthoringEntityTypeNamespace,
  type AuthoringTypeNamespace,
  assertNoAuthoringFieldNamespace,
  mergeAuthoringNamespaces,
} from '@internal/framework-components/authoring';
import { blindCast } from '@internal/utils/casts';
import type { AuthoringNamespaceKey } from './composed-helpers-scaffolding';
import { contractError } from './contract-errors';

const blockedSegments = new Set(['__proto__', 'constructor', 'prototype']);

export function assertSafeAuthoringHelperKey(key: string, path: readonly string[]): void {
  if (blockedSegments.has(key)) {
    throw contractError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `Invalid authoring helper "${[...path, key].join('.')}". Helper path segments must not use "${key}".`,
      { meta: { helperPath: [...path, key].join('.'), segment: key } },
    );
  }
}

function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0;
}

const descriptorKindByNamespace = {
  type: { descriptorKind: AUTHORING_TYPE_DESCRIPTOR_KINDS, label: 'type' },
  entityTypes: { descriptorKind: 'entity', label: 'entity' },
} as const satisfies Record<
  AuthoringNamespaceKey,
  { descriptorKind: AuthoringDescriptorKinds; label: string }
>;

interface AuthoringNamespaceByKey {
  readonly type: AuthoringTypeNamespace;
  readonly entityTypes: AuthoringEntityTypeNamespace;
}

/**
 * Merges one authoring namespace (`type` or `entityTypes`) across the family, target and extension packs, in order. A duplicate helper path across packs throws, and so does a pack that still contributes `authoring.field`.
 */
export function composePackAuthoringNamespace<Key extends AuthoringNamespaceKey>(
  components: readonly {
    readonly id?: string;
    readonly authoring?: { readonly [K in AuthoringNamespaceKey]?: unknown };
  }[],
  key: Key,
): AuthoringNamespaceByKey[Key] {
  const { descriptorKind, label } = descriptorKindByNamespace[key];
  const merged: Record<string, unknown> = {};
  for (const component of components) {
    assertNoAuthoringFieldNamespace(component.id ?? '<unknown>', component.authoring);
    const namespace = component.authoring?.[key];
    if (isNonEmptyRecord(namespace)) {
      mergeAuthoringNamespaces(merged, namespace, [], descriptorKind, label);
    }
  }
  return blindCast<
    AuthoringNamespaceByKey[Key],
    'mergeAuthoringNamespaces checks every leaf against the descriptor kind for this key while merging'
  >(merged);
}
