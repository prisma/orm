import {
  type AuthoringEntityTypeNamespace,
  type AuthoringFieldNamespace,
  type AuthoringFieldPresetDescriptor,
  type AuthoringTypeNamespace,
  isAuthoringFieldPresetDescriptor,
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

/**
 * Walks a field-preset namespace and produces the callable surface mirroring its tree shape. Each leaf descriptor becomes the helper `createLeafHelper` returns; nested namespaces recurse.
 */
export function createFieldHelpersFromNamespace(
  namespace: AuthoringFieldNamespace,
  createLeafHelper: (options: {
    readonly helperPath: string;
    readonly descriptor: AuthoringFieldPresetDescriptor;
  }) => (...rawArgs: readonly unknown[]) => unknown,
  path: readonly string[] = [],
): Record<string, unknown> {
  const helpers: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(namespace)) {
    assertSafeAuthoringHelperKey(key, path);
    const currentPath = [...path, key];

    if (isAuthoringFieldPresetDescriptor(value)) {
      helpers[key] = createLeafHelper({
        helperPath: currentPath.join('.'),
        descriptor: value,
      });
      continue;
    }

    helpers[key] = createFieldHelpersFromNamespace(value, createLeafHelper, currentPath);
  }

  return helpers;
}

function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0;
}

const descriptorKindByNamespace = {
  type: { descriptorKind: 'typeConstructor', label: 'type' },
  field: { descriptorKind: 'fieldPreset', label: 'field' },
  entityTypes: { descriptorKind: 'entity', label: 'entity' },
} as const satisfies Record<AuthoringNamespaceKey, { descriptorKind: string; label: string }>;

interface AuthoringNamespaceByKey {
  readonly type: AuthoringTypeNamespace;
  readonly field: AuthoringFieldNamespace;
  readonly entityTypes: AuthoringEntityTypeNamespace;
}

/**
 * Merges one authoring namespace (`type`, `field` or `entityTypes`) across the family, target and extension packs, in order. A duplicate helper path across packs throws.
 */
export function composePackAuthoringNamespace<Key extends AuthoringNamespaceKey>(
  components: readonly {
    readonly authoring?: { readonly [K in AuthoringNamespaceKey]?: unknown };
  }[],
  key: Key,
): AuthoringNamespaceByKey[Key] {
  const { descriptorKind, label } = descriptorKindByNamespace[key];
  const merged: Record<string, unknown> = {};
  for (const component of components) {
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
