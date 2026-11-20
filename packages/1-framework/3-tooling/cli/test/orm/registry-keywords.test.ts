import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  lookUpRegistryKeywords,
  REGISTRY_LOOKUP_TIMEOUT_MILLIS,
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  requested.length = 0;
});

describe('lookUpRegistryKeywords', () => {
  it('reads the keywords of the latest version of an unscoped package from the public registry', async () => {
    answer(manifest({ name: 'acmedb', version: '1.0.0', keywords: ['prisma-orm-extension'] }));

    const result = await lookUpRegistryKeywords('acmedb', {});

    expect(result).toEqual({
      kind: 'read',
      registry: 'https://registry.npmjs.org',
      keywords: ['prisma-orm-extension'],
    });
    expect(requested.map(({ url }) => url)).toEqual(['https://registry.npmjs.org/acmedb/latest']);
  });

  it('encodes the slash of a scoped name', async () => {
    answer(manifest({ name: '@acme/orm-db', version: '1.0.0' }));

    const result = await lookUpRegistryKeywords('@acme/orm-db', {});

    expect(result).toEqual({ kind: 'read', registry: 'https://registry.npmjs.org', keywords: [] });
    expect(requested.map(({ url }) => url)).toEqual([
      'https://registry.npmjs.org/@acme%2Form-db/latest',
    ]);
  });

  it('asks the registry npm_config_registry names, with or without a trailing slash', async () => {
    answer(manifest({ name: 'acmedb', version: '1.0.0', keywords: ['other'] }));

    const result = await lookUpRegistryKeywords('acmedb', {
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

  it('keeps only the string keywords', async () => {
    answer(manifest({ name: 'acmedb', version: '1.0.0', keywords: ['a', 3, null, 'b'] }));

    expect(await lookUpRegistryKeywords('acmedb', {})).toMatchObject({ keywords: ['a', 'b'] });
  });

  it('reports a 404 as no such package', async () => {
    answer(manifest({ error: 'Not found' }, 404));

    expect(await lookUpRegistryKeywords('acmedb', {})).toEqual({
      kind: 'not-found',
      registry: 'https://registry.npmjs.org',
    });
  });

  it.each([401, 403, 500])('reports status %i as a failed lookup', async (status) => {
    answer(manifest({ error: 'nope' }, status));

    expect(await lookUpRegistryKeywords('acmedb', {})).toEqual({
      kind: 'failed',
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

    expect(await lookUpRegistryKeywords('acmedb', {})).toMatchObject({
      kind: 'failed',
      registry: 'https://registry.npmjs.org',
      cause: expect.stringMatching(/^the registry's answer is not a package manifest/),
    });
  });

  it('reports a network error as a failed lookup', async () => {
    answer(async () => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') });
    });

    expect(await lookUpRegistryKeywords('acmedb', {})).toEqual({
      kind: 'failed',
      registry: 'https://registry.npmjs.org',
      cause: 'fetch failed (getaddrinfo ENOTFOUND)',
    });
  });

  it('gives up after the timeout', async () => {
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

    const pending = lookUpRegistryKeywords('acmedb', {});
    await vi.advanceTimersByTimeAsync(REGISTRY_LOOKUP_TIMEOUT_MILLIS);

    expect(await pending).toEqual({
      kind: 'failed',
      registry: 'https://registry.npmjs.org',
      cause: `the registry did not answer within ${REGISTRY_LOOKUP_TIMEOUT_MILLIS / 1000} seconds`,
    });
  });
});
