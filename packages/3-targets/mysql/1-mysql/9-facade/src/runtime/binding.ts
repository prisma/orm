import type { MysqlBinding } from '@internal/driver-mysql/runtime';
import type { MysqlRuntimeTargetMeta } from '@internal/target-mysql/runtime';
import { structuredError } from '@internal/utils/structured-error';

export type MysqlBindingInput = { readonly url: string };

type BindingTarget = Pick<MysqlRuntimeTargetMeta<string>, 'targetId' | 'displayName'>;

function invalidUrl(target: BindingTarget, message: string, meta: Record<string, string>): Error {
  return structuredError('RUNTIME.BINDING_INVALID', message, {
    meta: { extension: target.targetId, ...meta },
  });
}

/** Checks `url` as the Postgres facade checks its own: a non-empty URL that parses, with one of `urlSchemes`. No part of the URL goes into the error, which names `target`. */
export function validateMysqlUrl(
  url: string,
  target: BindingTarget,
  urlSchemes: readonly string[],
): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw invalidUrl(target, `${target.displayName} URL must be a non-empty string`, {
      reason: 'empty url',
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    const withHost = trimmed.replace(/^([^:/?#]+:\/\/[^/?#]*@)(\/|$|\?|#)/, '$1localhost$2');
    try {
      parsed = new URL(withHost);
    } catch {
      throw invalidUrl(target, `${target.displayName} URL must be a valid URL`, {
        reason: 'unparseable url',
      });
    }
  }
  if (!urlSchemes.some((scheme) => parsed.protocol === `${scheme}:`)) {
    throw invalidUrl(
      target,
      `${target.displayName} URL must use ${urlSchemes.map((scheme) => `${scheme}://`).join(' or ')}`,
      { reason: 'wrong scheme', received: parsed.protocol },
    );
  }
  return trimmed;
}

export function resolveMysqlBinding(
  input: MysqlBindingInput,
  target: BindingTarget,
  urlSchemes: readonly string[],
): MysqlBinding {
  return { kind: 'url', url: validateMysqlUrl(input.url, target, urlSchemes) };
}

export function resolveOptionalMysqlBinding(
  options: { readonly url?: string },
  target: BindingTarget,
  urlSchemes: readonly string[],
): MysqlBinding | undefined {
  return options.url === undefined
    ? undefined
    : resolveMysqlBinding({ url: options.url }, target, urlSchemes);
}
