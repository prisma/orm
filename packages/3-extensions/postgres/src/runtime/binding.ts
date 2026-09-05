import { InternalError } from '@internal/utils/internal-error';
import type { Client, Pool } from 'pg';
import { postgresError } from '../errors';
import { userInfo } from 'node:os';

export const isPgPool = (pg: Pool | Client): pg is Pool =>
  'totalCount' in pg && 'idleCount' in pg && 'waitingCount' in pg;

export const isPgClient = (pg: Pool | Client): pg is Client =>
  'escapeIdentifier' in pg && 'escapeLiteral' in pg;

export type PostgresBinding =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'pgPool'; readonly pool: Pool }
  | { readonly kind: 'pgClient'; readonly client: Client };

export type PostgresBindingInput =
  | {
      readonly binding: PostgresBinding;
      readonly url?: never;
      readonly pg?: never;
    }
  | {
      readonly url: string;
      readonly binding?: never;
      readonly pg?: never;
    }
  | {
      readonly pg: Pool | Client;
      readonly binding?: never;
      readonly url?: never;
    };

type PostgresBindingFields = {
  readonly binding?: PostgresBinding;
  readonly url?: string;
  readonly pg?: Pool | Client;
};

function normalizePostgresUrlIfNeeded(trimmed: string): string {
  // Fast-path: nothing to do if nothing missing
  try {
    const parsed = new URL(trimmed);
    let changed = false;

    // If username is not present in the URL *and* the original string did not
    // include an explicit userinfo (`@`), default to the OS username. This
    // mirrors libpq/psql behaviour where an omitted user falls back to the
    // current user. We avoid overriding an explicitly empty user (`postgresql://@host/...`).
    const authorityStart = trimmed.indexOf('//') + 2;
    const authorityTail = trimmed.slice(authorityStart);
    const authorityEnd = authorityTail.search(/[/?#]/);
    const authority =
      authorityEnd === -1 ? authorityTail : authorityTail.slice(0, authorityEnd);

    if (!parsed.username && !authority.includes('@')) {
      try {
        const defaultUser = userInfo().username;
        if (defaultUser) {
          parsed.username = defaultUser;
          changed = true;
        }
      } catch {
        // If userInfo fails for any reason, skip defaulting the username.
      }
    }

    // If no hostname is provided, fall back to localhost so node-postgres
    // connects over TCP to the local server (common local-dev setup).
    // This also prevents printing `undefined` for the host in diagnostics.
    if (!parsed.hostname) {
      parsed.hostname = 'localhost';
      changed = true;
    }

    return changed ? parsed.toString() : trimmed;
  } catch {
    // If parsing fails here, let the caller handle the parse error path.
    return trimmed;
  }
}

function validatePostgresUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw postgresError('RUNTIME.BINDING_INVALID', 'Postgres URL must be a non-empty string', {
      meta: { extension: 'postgres', reason: 'empty url' },
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw postgresError('RUNTIME.BINDING_INVALID', 'Postgres URL must be a valid URL', {
      meta: { extension: 'postgres', reason: 'unparseable url' },
    });
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw postgresError(
      'RUNTIME.BINDING_INVALID',
      'Postgres URL must use postgres:// or postgresql://',
      { meta: { extension: 'postgres', reason: 'wrong scheme', received: parsed.protocol } },
    );
  }

  // Normalize missing user/host to sensible defaults so `postgresql:///db`
  // and `postgresql://localhost/db` behave like libpq/psql on local dev.
  return normalizePostgresUrlIfNeeded(trimmed);
}

export function resolvePostgresBinding(options: PostgresBindingInput): PostgresBinding {
  const providedCount =
    Number(options.binding !== undefined) +
    Number(options.url !== undefined) +
    Number(options.pg !== undefined);

  if (providedCount !== 1) {
    throw postgresError(
      'RUNTIME.BINDING_INVALID',
      'Provide one binding input: binding, url, or pg',
      {
        fix: 'Pass exactly one of `binding`, `url`, or `pg`.',
        meta: { extension: 'postgres', reason: 'zero or multiple binding inputs' },
      },
    );
  }

  if (options.binding !== undefined) {
    return options.binding;
  }

  if (options.url !== undefined) {
    return { kind: 'url', url: validatePostgresUrl(options.url) };
  }

  const pgBinding = options.pg;
  if (pgBinding === undefined) {
    throw new InternalError('Invariant violation: expected pg binding after validation');
  }

  if (isPgPool(pgBinding)) {
    return { kind: 'pgPool', pool: pgBinding };
  }

  if (isPgClient(pgBinding)) {
    return { kind: 'pgClient', client: pgBinding };
  }

  throw postgresError(
    'RUNTIME.BINDING_INVALID',
    'Unable to determine pg binding type from pg input; use binding with explicit kind',
    {
      fix: 'Pass `binding: { kind: "pgPool", pool }` or `binding: { kind: "pgClient", client }` instead of `pg`.',
      meta: { extension: 'postgres', reason: 'unrecognizable pg object' },
    },
  );
}

export function resolveOptionalPostgresBinding(
  options: PostgresBindingFields,
): PostgresBinding | undefined {
  const providedCount =
    Number(options.binding !== undefined) +
    Number(options.url !== undefined) +
    Number(options.pg !== undefined);

  if (providedCount === 0) {
    return undefined;
  }

  return resolvePostgresBinding(options as PostgresBindingInput);
}
