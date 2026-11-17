import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { UNBOUND_PSL_NAMESPACE_NAME } from '@internal/framework-components/psl-ast';

export function namespaceIdOfPslName(name: string): string {
  return name === UNBOUND_PSL_NAMESPACE_NAME ? UNBOUND_NAMESPACE_ID : name;
}

export function pslNameOfNamespaceId(id: string): string {
  return id === UNBOUND_NAMESPACE_ID ? UNBOUND_PSL_NAMESPACE_NAME : id;
}

export function pslNamesOfNamespaceId(id: string): readonly string[] {
  return id === UNBOUND_NAMESPACE_ID ? [UNBOUND_PSL_NAMESPACE_NAME, UNBOUND_NAMESPACE_ID] : [id];
}
