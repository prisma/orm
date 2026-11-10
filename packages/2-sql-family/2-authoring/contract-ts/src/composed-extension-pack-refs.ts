import type { ExtensionPackRef, TargetPackRef } from '@internal/framework-components/components';

/**
 * The contract's `extensions`: each composed extension pack by id, in id order. A pack takes its known ref when one is given, and otherwise a ref built from the target.
 */
export function composedExtensionPackRefs(
  target: Pick<TargetPackRef<'sql', string>, 'familyId' | 'targetId'>,
  extensionIds: Iterable<string>,
  knownPackRefs: readonly ExtensionPackRef<'sql', string>[] = [],
): Record<string, ExtensionPackRef<'sql', string>> | undefined {
  const ids = [...new Set(extensionIds)].sort();
  if (ids.length === 0) return undefined;
  const knownById = new Map(knownPackRefs.map((packRef) => [packRef.id, packRef]));
  return Object.fromEntries(
    ids.map((id) => [
      id,
      knownById.get(id) ??
        ({
          kind: 'extension',
          id,
          familyId: target.familyId,
          targetId: target.targetId,
          version: '0.0.1',
        } satisfies ExtensionPackRef<'sql', string>),
    ]),
  );
}
