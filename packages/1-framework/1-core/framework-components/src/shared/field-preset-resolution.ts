import {
  type AuthoringContributions,
  type AuthoringFieldNamespace,
  type AuthoringFieldPresetDescriptor,
  hasRegisteredFieldNamespace,
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

/**
 * Returns the namespace prefix of `attributeName` when it names an extension namespace that is not composed, otherwise `undefined`. A namespace is recognized when it is:
 *
 * - `db` (native-type spec, always allowed),
 * - the active family id,
 * - the active target id,
 * - a registered field-preset namespace (e.g. `temporal`),
 * - present in `composedExtensions`.
 *
 * Family, target, and field-preset namespaces are exempt so an attribute that does not exist under them surfaces as an unsupported attribute rather than as an uncomposed extension namespace.
 */
export function checkUncomposedNamespace(
  attributeName: string,
  composedExtensions: ReadonlySet<string>,
  context?: {
    readonly familyId?: string;
    readonly targetId?: string;
    readonly authoringContributions?: AuthoringContributions | undefined;
  },
): string | undefined {
  const dotIndex = attributeName.indexOf('.');
  if (dotIndex <= 0 || dotIndex === attributeName.length - 1) {
    return undefined;
  }
  const namespace = attributeName.slice(0, dotIndex);
  if (
    namespace === 'db' ||
    namespace === context?.familyId ||
    namespace === context?.targetId ||
    hasRegisteredFieldNamespace(context?.authoringContributions, namespace) ||
    composedExtensions.has(namespace)
  ) {
    return undefined;
  }
  return namespace;
}
