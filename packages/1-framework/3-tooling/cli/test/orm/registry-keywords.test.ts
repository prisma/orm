import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  lookUpRegistryKeywords,
  REGISTRY_LOOKUP_TIMEOUT_MILLIS,
  REGISTRY_MANIFEST_LIMIT_BYTES,
} from '../../src/orm/registry-keywords';

const requested: { url: string; signal: AbortSignal | undefined }[] = [];

function answer(respond: () => Promise<Response>): void {
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    requested.push({ url: String(url), signal: init?.signal ?? undefined });
    return respond();
  });
}

function manifest(body: unknown, status = 200): () => Promise<Response> {
  return async () => new Response(JSON.stringify(body), { status });
}

function lookUp(
  packageName: string,
  env: Readonly<Record<string, string | undefined>> = {},
  signal: AbortSignal = new AbortController().signal,
) {
  return lookUpRegistryKeywords(packageName, { env, signal });
}

/** A body that sends its first bytes and then nothing more. */
function stalledBody(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"name":'));
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  requested.length = 0;
});

describe('lookUpRegistryKeywords', () => {
  it('reads the keywords of the latest version of an unscoped package from the public registry', async () => {
    answer(manifest({ name: 'acmedb', version: '1.0.0', keywords: ['prisma-orm-extension'] }));

    const result = await lookUp('acmedb');

    expect(result).toEqual({
      kind: 'read',
      registry: 'https://registry.npmjs.org',
      keywords: ['prisma-orm-extension'],
    });
    expect(requested.map(({ url }) => url)).toEqual(['https://registry.npmjs.org/acmedb/latest']);
  });

  it('encodes the slash of a scoped name', async () => {
    answer(manifest({ name: '@acme/orm-db', version: '1.0.0' }));

    const result = await lookUp('@acme/orm-db');

    expect(result).toEqual({ kind: 'read', registry: 'https://registry.npmjs.org', keywords: [] });
    expect(requested.map(({ url }) => url)).toEqual([
      'https://registry.npmjs.org/@acme%2Form-db/latest',
    ]);
  });

  it('asks the registry npm_config_registry names, with or without a trailing slash', async () => {
    answer(manifest({ name: 'acmedb', version: '1.0.0', keywords: ['other'] }));

    const result = await lookUp('acmedb', {
      npm_config_registry: 'https://registry.example.test/npm/',
    });

    expect(result).toEqual({
      kind: 'read',
      registry: 'https://registry.example.test/npm',
      keywords: ['other'],
    });
    expect(requested.map(({ url }) => url)).toEqual([
      'https://registry.example.test/npm/acmedb/latest',
    ]);
  });

  it('reads the registry variable in any letter case', async () => {
    answer(manifest({ name: 'acmedb', version: '1.0.0' }));

    await lookUp('acmedb', { NPM_CONFIG_REGISTRY: 'https://upper.example.test' });

    expect(requested.map(({ url }) => url)).toEqual(['https://upper.example.test/acmedb/latest']);
  });

  it('prefers the lower-case spelling when several are set', async () => {
    answer(manifest({ name: 'acmedb', version: '1.0.0' }));

    await lookUp('acmedb', {
      NPM_CONFIG_REGISTRY: 'https://upper.example.test',
      npm_config_registry: 'https://lower.example.test',
      Npm_Config_Registry: 'https://mixed.example.test',
    });

    expect(requested.map(({ url }) => url)).toEqual(['https://lower.example.test/acmedb/latest']);
  });

  it('sends no credentials and shows none, from a registry URL that carries them', async () => {
    answer(async () => {
      throw new TypeError(
        'Request cannot be constructed from a URL that includes credentials: https://user:token@registry.example/acmedb/latest',
      );
    });

    const result = await lookUp('acmedb', {
      npm_config_registry: 'https://user:token@registry.example/',
    });

    expect(requested.map(({ url }) => url)).toEqual(['https://registry.example/acmedb/latest']);
    expect(result).toMatchObject({
      kind: 'lookup-failed',
      registry: 'https://****:****@registry.example',
    });
    expect(JSON.stringify(result)).not.toContain('token');
  });

  it('keeps only the string keywords', async () => {
    answer(manifest({ name: 'acmedb', version: '1.0.0', keywords: ['a', 3, null, 'b'] }));

    expect(await lookUp('acmedb')).toMatchObject({ keywords: ['a', 'b'] });
  });

  it('reports a 404 as no such package', async () => {
    answer(manifest({ error: 'Not found' }, 404));

    expect(await lookUp('acmedb')).toEqual({
      kind: 'not-found',
      registry: 'https://registry.npmjs.org',
    });
  });

  it.each([401, 403, 500])('reports status %i as a failed lookup', async (status) => {
    answer(manifest({ error: 'nope' }, status));

    expect(await lookUp('acmedb')).toEqual({
      kind: 'lookup-failed',
      registry: 'https://registry.npmjs.org',
      cause: `the registry answered with status ${status}`,
    });
  });

  it.each([
    ['a body that is not JSON', async () => new Response('<html>', { status: 200 })],
    ['a body that is not a manifest', manifest(['acmedb'])],
    ['a manifest without a version', manifest({ name: 'acmedb' })],
  ])('reports %s as a failed lookup', async (_, respond) => {
    answer(respond);

    expect(await lookUp('acmedb')).toMatchObject({
      kind: 'lookup-failed',
      registry: 'https://registry.npmjs.org',
      cause: expect.stringMatching(/^the registry's answer is not a package manifest/),
    });
  });

  it('refuses a body larger than the limit', async () => {
    const padding = 'x'.repeat(REGISTRY_MANIFEST_LIMIT_BYTES);
    answer(manifest({ name: 'acmedb', version: '1.0.0', readme: padding }));

    expect(await lookUp('acmedb')).toEqual({
      kind: 'lookup-failed',
      registry: 'https://registry.npmjs.org',
      cause: `the registry's answer is larger than ${REGISTRY_MANIFEST_LIMIT_BYTES / 1024 / 1024} MiB`,
    });
  });

  it('reports a network error with its cause', async () => {
    answer(async () => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') });
    });

    expect(await lookUp('acmedb')).toEqual({
      kind: 'lookup-failed',
      registry: 'https://registry.npmjs.org',
      cause: 'fetch failed (getaddrinfo ENOTFOUND)',
    });
  });

  it('names the code of a network error whose cause has no message', async () => {
    answer(async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' }),
      });
    });

    expect(await lookUp('acmedb')).toMatchObject({ cause: 'fetch failed (ECONNREFUSED)' });
  });

  it('gives up when the headers do not arrive within the timeout', async () => {
    vi.useFakeTimers();
    answer(
      () =>
        new Promise((_, reject) => {
          requested
            .at(-1)
            ?.signal?.addEventListener('abort', () =>
              reject(new DOMException('This operation was aborted', 'AbortError')),
            );
        }),
    );

    const pending = lookUp('acmedb');
    await vi.advanceTimersByTimeAsync(REGISTRY_LOOKUP_TIMEOUT_MILLIS);

    expect(await pending).toEqual({
      kind: 'lookup-failed',
      registry: 'https://registry.npmjs.org',
      cause: `the registry did not answer within ${REGISTRY_LOOKUP_TIMEOUT_MILLIS / 1000} seconds`,
    });
  });

  it('gives up when the body does not end within the timeout', async () => {
    vi.useFakeTimers();
    answer(async () => new Response(stalledBody(), { status: 200 }));

    const pending = lookUp('acmedb');
    await vi.advanceTimersByTimeAsync(REGISTRY_LOOKUP_TIMEOUT_MILLIS);

    expect(await pending).toMatchObject({
      kind: 'lookup-failed',
      cause: `the registry did not answer within ${REGISTRY_LOOKUP_TIMEOUT_MILLIS / 1000} seconds`,
    });
  });

  it('does not time out a lookup that has already answered', async () => {
    vi.useFakeTimers();
    answer(manifest({ name: 'acmedb', version: '1.0.0' }));

    await lookUp('acmedb');

    expect(vi.getTimerCount()).toBe(0);
  });

  it('rethrows the reason when the run is cancelled', async () => {
    answer(async () => new Response(stalledBody(), { status: 200 }));
    const run = new AbortController();
    const reason = new DOMException('cancelled', 'AbortError');

    const pending = lookUp('acmedb', {}, run.signal);
    run.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });
});
