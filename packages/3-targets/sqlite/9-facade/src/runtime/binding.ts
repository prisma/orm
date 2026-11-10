import type { SqliteBinding } from '@internal/driver-sqlite/runtime';

export type SqliteBindingInput = { readonly path: string };

export function resolveSqliteBinding(input: SqliteBindingInput): SqliteBinding {
  return { kind: 'path', path: input.path };
}

export function resolveOptionalSqliteBinding(options: {
  readonly path?: string;
}): SqliteBinding | undefined {
  if (options.path === undefined) {
    return undefined;
  }
  return { kind: 'path', path: options.path };
}
