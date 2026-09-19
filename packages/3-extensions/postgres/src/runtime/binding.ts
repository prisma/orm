import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import type { Client, Pool } from 'pg';
import { postgresError } from '../errors';

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

  return trimmed;
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

  return resolvePostgresBinding(
    blindCast<
      PostgresBindingInput,
      'provided-count validation narrows optional binding fields to one binding input'
    >(options),
  );
}
