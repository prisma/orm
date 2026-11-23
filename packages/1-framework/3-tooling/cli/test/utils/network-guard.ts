const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface NetworkGuard {
  readonly fetch: typeof fetch;
  /** The URLs refused since the last call. */
  takeBlocked(): string[];
}

/**
 * A `fetch` that passes requests to this machine to `realFetch` and refuses any other, recording
 * its URL so a test fails even when the code under test catches the refusal.
 */
export function createNetworkGuard(realFetch: typeof fetch): NetworkGuard {
  const blocked: string[] = [];
  return {
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!LOCAL_HOSTS.has(url.hostname)) {
        blocked.push(url.href);
        throw new Error(`a test tried to reach the network: ${url.href}`);
      }
      return realFetch(input, init);
    },
    takeBlocked: () => blocked.splice(0),
  };
}
