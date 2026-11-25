import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';

/** A declared namespace coordinate, where an omitted or empty one means the target's default namespace. */
export function namespaceIdOrDefault(
  namespaceId: string | undefined,
  defaultNamespaceId: string,
): string {
  return namespaceId !== undefined && namespaceId.length > 0 ? namespaceId : defaultNamespaceId;
}

function isNamed(namespaceId: string | undefined): namespaceId is string {
  return namespaceId !== undefined && namespaceId !== UNBOUND_NAMESPACE_ID;
}

/** Where an error message places a name: ` in namespace "public"`, or nothing for the unbound namespace a target without namespaces uses. */
export function inNamespace(namespaceId: string | undefined): string {
  return isNamed(namespaceId) ? ` in namespace "${namespaceId}"` : '';
}

/** How far an error message says a name must be unique: ` per namespace`, or nothing for the unbound namespace a target without namespaces uses. */
export function perNamespace(namespaceId: string | undefined): string {
  return isNamed(namespaceId) ? ' per namespace' : '';
}
