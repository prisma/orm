import type { MysqlBinding } from '@internal/driver-mysql/runtime';
import { structuredError } from '@internal/utils/structured-error';

export type MysqlBindingInput = { readonly url: string };

function invalidUrl(message: string, meta: Record<string, string>): Error {
  return structuredError('RUNTIME.BINDING_INVALID', message, {
    meta: { extension: 'mysql', ...meta },
  });
}

/** Checks `url` as the Postgres facade checks its own: a non-empty URL that parses, with the `mysql://` scheme. No part of the URL goes into the error. */
export function validateMysqlUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw invalidUrl('MySQL URL must be a non-empty string', { reason: 'empty url' });
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw invalidUrl('MySQL URL must be a valid URL', { reason: 'unparseable url' });
  }
  if (parsed.protocol !== 'mysql:') {
    throw invalidUrl('MySQL URL must use mysql://', {
      reason: 'wrong scheme',
      received: parsed.protocol,
    });
  }
  return trimmed;
}

export function resolveMysqlBinding(input: MysqlBindingInput): MysqlBinding {
  return { kind: 'url', url: validateMysqlUrl(input.url) };
}

export function resolveOptionalMysqlBinding(options: {
  readonly url?: string;
}): MysqlBinding | undefined {
  return options.url === undefined ? undefined : resolveMysqlBinding({ url: options.url });
}
