export interface ClientEventSource {
  on(event: 'error' | 'end', listener: () => void): unknown;
}

const watchedClients = new WeakSet<ClientEventSource>();
const lostClients = new WeakSet<ClientEventSource>();

/**
 * Records when a pg client emits `error` or `end`. pg emits both before the failed query's
 * promise rejects, so a caller handling that rejection already sees the loss.
 */
export function watchClientLoss<T extends ClientEventSource>(client: T): T {
  if (!watchedClients.has(client)) {
    watchedClients.add(client);
    const markLost = () => lostClients.add(client);
    client.on('error', markLost);
    client.on('end', markLost);
  }
  return client;
}

/**
 * Whether a client can no longer run queries: it emitted `error` or `end` while watched, a driver
 * gave up on it, or pg's own state says it was ended or broke before the driver saw it.
 */
export function hasLostConnection(client: ClientEventSource): boolean {
  return lostClients.has(client) || hasEndedOrBroken(client);
}

/** Records that a driver gave up on a client it does not own, so no driver uses it again. */
export function markClientAbandoned(client: ClientEventSource): void {
  lostClients.add(client);
}

// pg exposes no public flags for a client's connection state, so the two functions below read
// pg's own `_connected`, `_connecting`, `_ending` and `_queryable` fields.

/** Whether a pg `Client` has connected or begun connecting. */
export function hasStartedConnecting(client: object): boolean {
  return (
    ('_connected' in client && client._connected === true) ||
    ('_connecting' in client && client._connecting === true)
  );
}

/** Whether a pg client was ended (`end()` was called) or broke (`error` made it unqueryable). */
function hasEndedOrBroken(client: object): boolean {
  return (
    ('_ending' in client && client._ending === true) ||
    ('_queryable' in client && client._queryable === false)
  );
}
