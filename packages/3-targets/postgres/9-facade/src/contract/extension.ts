import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { UNBOUND_PSL_NAMESPACE_NAME } from '@internal/framework-components/psl-ast';
import { unbound } from '@internal/sql-contract-ts/contract-builder';
import { postgresError } from '../errors';

export interface ExtensionHandle<Name extends string = string> {
  readonly entityKind: 'extension';
  readonly name: Name;
  readonly namespace?: string;
}

/**
 * Declares a Postgres extension the database must have installed, mirroring PSL's `extension <name> {}`. Place it in the `entities` list; `namespace` names the namespace whose schema holds the extension's objects, the default namespace when omitted. Pass `unbound` to have the extension found through the connection's `search_path`.
 */
export function extension<const Name extends string>(
  name: Name,
  options?: { readonly namespace?: string | typeof unbound },
): ExtensionHandle<Name> {
  if (name.trim().length === 0) {
    throw postgresError(
      'CONTRACT.ARGUMENT_INVALID',
      `extension("${name}"): name must be a non-empty string.`,
      { fix: 'Pass the extension name, such as "pg_trgm".', meta: { extensionName: name } },
    );
  }
  const namespace = namespaceIdOf(name, options?.namespace);
  return Object.freeze({
    entityKind: 'extension' as const,
    name,
    ...(namespace === undefined ? {} : { namespace }),
  });
}

function namespaceIdOf(name: string, namespace: string | typeof unbound | undefined) {
  if (namespace === unbound) {
    return UNBOUND_NAMESPACE_ID;
  }
  if (namespace === UNBOUND_PSL_NAMESPACE_NAME || namespace === UNBOUND_NAMESPACE_ID) {
    throw postgresError(
      'CONTRACT.ARGUMENT_INVALID',
      `extension("${name}"): namespace "${namespace}" is reserved; pass the unbound symbol to declare the extension in the unbound namespace.`,
      {
        fix: 'Import `unbound` from the contract builder and pass `{ namespace: unbound }`.',
        meta: { extensionName: name, namespace },
      },
    );
  }
  return namespace;
}
