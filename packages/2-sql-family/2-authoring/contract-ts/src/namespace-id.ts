import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';

/** A declared namespace coordinate, where an omitted or empty one means the target's default namespace. */
export function namespaceIdOrDefault(
  namespaceId: string | undefined,
  defaultNamespaceId: string,
): string {
  return namespaceId !== undefined && namespaceId.length > 0 ? namespaceId : defaultNamespaceId;
}

/** Where an error message places a name: ` in namespace "public"`, or nothing for the unbound namespace a target without namespaces uses. */
export function inNamespace(namespaceId: string | undefined): string {
  return namespaceId === undefined || namespaceId === UNBOUND_NAMESPACE_ID
    ? ''
    : ` in namespace "${namespaceId}"`;
}
