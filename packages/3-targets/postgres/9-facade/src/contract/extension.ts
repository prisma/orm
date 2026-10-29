import { postgresError } from '../errors';

export interface ExtensionHandle<Name extends string = string> {
  readonly entityKind: 'extension';
  readonly name: Name;
  readonly namespace?: string;
}

/**
 * Declares a Postgres extension the database must have installed, mirroring PSL's `extension <name> {}`. Place it in the `entities` list; `namespace` names the namespace whose schema holds the extension's objects, the default namespace when omitted.
 */
export function extension<const Name extends string>(
  name: Name,
  options?: { readonly namespace?: string },
): ExtensionHandle<Name> {
  if (name.trim().length === 0) {
    throw postgresError(
      'CONTRACT.ARGUMENT_INVALID',
      `extension("${name}"): name must be a non-empty string.`,
      { fix: 'Pass the extension name, such as "pg_trgm".', meta: { extensionName: name } },
    );
  }
  return Object.freeze({
    entityKind: 'extension' as const,
    name,
    ...(options?.namespace === undefined ? {} : { namespace: options.namespace }),
  });
}
