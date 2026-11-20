import { type } from 'arktype';

/** What the registry says about the latest version of a package. */
export type RegistryKeywords =
  | { readonly kind: 'read'; readonly registry: string; readonly keywords: readonly string[] }
  | { readonly kind: 'not-found'; readonly registry: string }
  | { readonly kind: 'failed'; readonly registry: string; readonly cause: string };

/** Reads the `keywords` of the latest version of a package from the registry `env` names. */
export type LookUpRegistryKeywords = (
  packageName: string,
  env: Readonly<Record<string, string | undefined>>,
) => Promise<RegistryKeywords>;

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

export const REGISTRY_LOOKUP_TIMEOUT_MILLIS = 10_000;

const LatestManifest = type({ name: 'string', version: 'string' });

function registryOf(env: Readonly<Record<string, string | undefined>>): string {
  const configured = env['npm_config_registry']?.trim();
  return (configured === undefined || configured === '' ? DEFAULT_REGISTRY : configured).replace(
    /\/+$/,
    '',
  );
}

/** The string entries of a manifest's `keywords`; none when it has no list there. */
export function keywordsOf(manifest: unknown): readonly string[] {
  const keywords: unknown =
    typeof manifest === 'object' && manifest !== null
      ? Reflect.get(manifest, 'keywords')
      : undefined;
  return Array.isArray(keywords)
    ? keywords.filter((keyword): keyword is string => typeof keyword === 'string')
    : [];
}

function failureMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}

async function fetchWithin(url: string, millis: number): Promise<Response | 'timed-out'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), millis);
  try {
    return await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
  } catch (error) {
    if (controller.signal.aborted) {
      return 'timed-out';
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const lookUpRegistryKeywords: LookUpRegistryKeywords = async (packageName, env) => {
  const registry = registryOf(env);
  const url = `${registry}/${packageName.replace('/', '%2F')}/latest`;
  const failed = (cause: string): RegistryKeywords => ({ kind: 'failed', registry, cause });
  let response: Response | 'timed-out';
  try {
    response = await fetchWithin(url, REGISTRY_LOOKUP_TIMEOUT_MILLIS);
  } catch (error) {
    return failed(failureMessage(error));
  }
  if (response === 'timed-out') {
    return failed(
      `the registry did not answer within ${REGISTRY_LOOKUP_TIMEOUT_MILLIS / 1000} seconds`,
    );
  }
  if (response.status === 404) {
    return { kind: 'not-found', registry };
  }
  if (!response.ok) {
    return failed(`the registry answered with status ${response.status}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return failed(`the registry's answer is not a package manifest: ${failureMessage(error)}`);
  }
  const manifest = LatestManifest(body);
  if (manifest instanceof type.errors) {
    return failed(`the registry's answer is not a package manifest: ${manifest.summary}`);
  }
  return { kind: 'read', registry, keywords: keywordsOf(manifest) };
};
