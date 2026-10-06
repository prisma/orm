import {
  type AuthoringContributions,
  type AuthoringFieldNamespace,
  type AuthoringFieldPresetDescriptor,
  isAuthoringFieldPresetDescriptor,
} from './framework-authoring';

function presetSpellingsUnder(members: AuthoringFieldNamespace, prefix: string): readonly string[] {
  return Object.entries(members).flatMap(([name, member]) =>
    isAuthoringFieldPresetDescriptor(member)
      ? [
          `${prefix}.${name}(${(member.args ?? []).map((arg, index) => arg.name ?? `argument${index + 1}`).join(', ')})`,
        ]
      : presetSpellingsUnder(member, `${prefix}.${name}`),
  );
}

/**
 * How each field preset registered under `namespace`, at any depth, is written, with the names of its arguments: `temporal.timestamp(onCreate, onUpdate)`.
 */
export function fieldPresetSpellings(
  contributions: AuthoringContributions | undefined,
  namespace: string,
): readonly string[] {
  const members = contributions?.field?.[namespace];
  if (members === undefined || isAuthoringFieldPresetDescriptor(members)) return [];
  return presetSpellingsUnder(members, namespace);
}

/**
 * Walks `authoringContributions.field` segment by segment and returns the field-preset descriptor at the path, or `undefined` when none is registered there.
 */
export function getAuthoringFieldPreset(
  contributions: AuthoringContributions | undefined,
  path: readonly string[],
): AuthoringFieldPresetDescriptor | undefined {
  let current: AuthoringFieldPresetDescriptor | AuthoringFieldNamespace | undefined =
    contributions?.field;

  for (const segment of path) {
    if (typeof current !== 'object' || current === null || 'kind' in current) {
      return undefined;
    }
    current = current[segment];
  }

  return current !== undefined && isAuthoringFieldPresetDescriptor(current) ? current : undefined;
}
