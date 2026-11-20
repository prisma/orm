import { describe, expect, it } from 'vitest';
import { createNetworkGuard } from './network-guard';

describe('createNetworkGuard', () => {
  it('refuses and records a request to another host', async () => {
    const guard = createNetworkGuard(async () => new Response('reached'));

    await expect(guard.fetch('https://registry.npmjs.org/acmedb/latest')).rejects.toThrow(
      'a test tried to reach the network: https://registry.npmjs.org/acmedb/latest',
    );
    expect(guard.takeBlocked()).toEqual(['https://registry.npmjs.org/acmedb/latest']);
    expect(guard.takeBlocked()).toEqual([]);
  });

  it.each(['http://localhost:4873/x', 'http://127.0.0.1:59032/x', 'http://[::1]:80/x'])(
    'lets a request to this machine through: %s',
    async (url) => {
      const guard = createNetworkGuard(async () => new Response('reached'));

      expect(await (await guard.fetch(url)).text()).toBe('reached');
      expect(guard.takeBlocked()).toEqual([]);
    },
  );
});
