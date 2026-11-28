import { type } from 'arktype';
import { redactUrlCredentials } from '../utils/url-credentials';
import { keywordsOf } from './package-manifest';

/** What asking the registry for the latest version of a package gave. `registry` is the URL asked, without credentials. */
export type RegistryLookup =
  | { readonly kind: 'read'; readonly registry: string; readonly keywords: readonly string[] }
  | { readonly kind: 'not-found'; readonly registry: string }
  | { readonly kind: 'lookup-failed'; readonly registry: string; readonly cause: string };

/**
 * Reads the `keywords` of the latest version of a package from the registry `env` names. Rejects
 * with the signal's reason when `signal` aborts.
 */
export type LookUpRegistryKeywords = (
  packageName: string,
  options: {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly signal: AbortSignal;
  },
) => Promise<RegistryLookup>;

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

export const REGISTRY_LOOKUP_TIMEOUT_MILLIS = 10_000;

export const REGISTRY_MANIFEST_LIMIT_BYTES = 1024 * 1024;

const REGISTRY_VARIABLE = 'npm_config_registry';

const LatestManifest = type({ name: 'string', version: 'string' });

class ManifestTooLarge extends Error {}

/** Package managers read their environment settings in any letter case; the lower-case one wins. */
function configuredRegistry(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const lower = env[REGISTRY_VARIABLE];
  if (lower !== undefined) {
    return lower;
  }
  const other = Object.keys(env).find((key) => key.toLowerCase() === REGISTRY_VARIABLE);
  return other === undefined ? undefined : env[other];
}

function registryOf(env: Readonly<Record<string, string | undefined>>): string {
  const configured = configuredRegistry(env)?.trim();
  return (configured === undefined || configured === '' ? DEFAULT_REGISTRY : configured).replace(
    /\/+$/,
    '',
  );
}

/** The registry URL without its userinfo, since init sends no credentials. */
function withoutCredentials(registry: string): string {
  try {
    const url = new URL(registry);
    url.username = '';
    url.password = '';
    return url.href.replace(/\/+$/, '');
  } catch {
    return redactUrlCredentials(registry);
  }
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const code = Reflect.get(error, 'code');
  return error.message !== '' ? error.message : typeof code === 'string' ? code : error.name;
}

function failureMessage(error: unknown): string {
  const message = describeError(error);
  if (!(error instanceof Error) || error.cause === undefined) {
    return message;
  }
  const cause = describeError(error.cause);
  return cause === '' ? message : `${message} (${cause})`;
}

function abortedWith(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

async function readBody(response: Response, signal: AbortSignal): Promise<string> {
  if (response.body === null) {
    return '';
  }
  const reader = response.body.getReader();
  const aborted = abortedWith(signal);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > REGISTRY_MANIFEST_LIMIT_BYTES) {
        throw new ManifestTooLarge();
      }
      chunks.push(value);
    }
  } catch (error) {
    reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    aborted.catch(() => undefined);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function readLatest(
  url: string,
  signal: AbortSignal,
): Promise<{ readonly status: number; readonly ok: boolean; readonly text: string }> {
  const response = await Promise.race([
    fetch(url, { signal, headers: { accept: 'application/json' } }),
    abortedWith(signal),
  ]);
  return { status: response.status, ok: response.ok, text: await readBody(response, signal) };
}

/** A version's manifest, as the registry gave it, or why it could not be read. */
type ManifestLookup =
  | { readonly kind: 'read'; readonly registry: string; readonly manifest: Record<string, unknown> }
  | Exclude<RegistryLookup, { readonly kind: 'read' }>;

async function lookUpManifest(
  packageName: string,
  spec: string,
  options: {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly signal: AbortSignal;
  },
): Promise<ManifestLookup> {
  const configured = registryOf(options.env);
  const registry = withoutCredentials(configured);
  const url = `${registry}/${packageName.replace('/', '%2F')}/${encodeURIComponent(spec)}`;
  const failed = (cause: string): ManifestLookup => ({
    kind: 'lookup-failed',
    registry,
    cause: redactUrlCredentials(cause),
  });

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REGISTRY_LOOKUP_TIMEOUT_MILLIS);
  const signal = AbortSignal.any([options.signal, timeout.signal]);
  let answer: Awaited<ReturnType<typeof readLatest>>;
  try {
    answer = await readLatest(url, signal);
  } catch (error) {
    if (options.signal.aborted) {
      throw options.signal.reason;
    }
    if (timeout.signal.aborted) {
      return failed(
        `the registry did not answer within ${REGISTRY_LOOKUP_TIMEOUT_MILLIS / 1000} seconds`,
      );
    }
    if (error instanceof ManifestTooLarge) {
      return failed(
        `the registry's answer is larger than ${REGISTRY_MANIFEST_LIMIT_BYTES / 1024 / 1024} MiB`,
      );
    }
    return failed(failureMessage(error));
  } finally {
    clearTimeout(timer);
  }

  if (answer.status === 404) {
    return { kind: 'not-found', registry };
  }
  if (!answer.ok) {
    return failed(`the registry answered with status ${answer.status}`);
  }
  let body: unknown;
  try {
    body = JSON.parse(answer.text);
  } catch (error) {
    return failed(`the registry's answer is not a package manifest: ${failureMessage(error)}`);
  }
  const manifest = LatestManifest(body);
  if (manifest instanceof type.errors) {
    return failed(`the registry's answer is not a package manifest: ${manifest.summary}`);
  }
  return { kind: 'read', registry, manifest };
}

export const lookUpRegistryKeywords: LookUpRegistryKeywords = async (packageName, options) => {
  const lookup = await lookUpManifest(packageName, 'latest', options);
  return lookup.kind === 'read'
    ? { kind: 'read', registry: lookup.registry, keywords: keywordsOf(lookup.manifest) }
    : lookup;
};

/**
 * The version and `peerDependencies` the registry `env` names publishes for `spec` (a version or a
 * dist-tag) of a package; `undefined` when it cannot be read.
 */
export type LookUpRegistryPeers = (
  packageName: string,
  spec: string,
  options: {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly signal: AbortSignal;
  },
) => Promise<PublishedPackage | undefined>;

export const lookUpRegistryPeers: LookUpRegistryPeers = async (packageName, spec, options) => {
  const lookup = await lookUpManifest(packageName, spec, options);
  if (lookup.kind !== 'read') {
    return undefined;
  }
  const version = lookup.manifest['version'];
  const peers = lookup.manifest['peerDependencies'];
  return {
    version: typeof version === 'string' ? version : undefined,
    peerDependencies:
      typeof peers === 'object' && peers !== null && !Array.isArray(peers)
        ? Object.fromEntries(
            Object.entries(peers).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : {},
    peerDependenciesMeta: lookup.manifest['peerDependenciesMeta'],
  };
};

/** What a published version names as its version and peers. */
export interface PublishedPackage {
  readonly version: string | undefined;
  readonly peerDependencies: Readonly<Record<string, string>>;
  /** Its `peerDependenciesMeta`, as published, which says which peers are optional. */
  readonly peerDependenciesMeta: unknown;
}
