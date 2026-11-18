/** A declared namespace coordinate, where an omitted or empty one means the target's default namespace. */
export function namespaceIdOrDefault(
  namespaceId: string | undefined,
  defaultNamespaceId: string,
): string {
  return namespaceId !== undefined && namespaceId.length > 0 ? namespaceId : defaultNamespaceId;
}
