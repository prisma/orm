/**
 * Sender script entry — forked into a detached child by the parent CLI via
 * `child_process.fork(senderPath, [], { detached: true, ... })`.
 *
 * Lifecycle:
 *   1. Wait for the parent's IPC `message` event carrying a
 *      `ParentToSenderPayload`.
 *   2. Enrich with the local-process probes (runtime, os, arch, agent,
 *      package manager, tsVersion).
 *   3. POST the event to the endpoint URL with a hard 1.5 s timeout.
 *   4. Exit 0 unconditionally — successful POST, network failure, server
 *      error, parse error of the response, anything else: same outcome.
 *
 * Every error is swallowed; the only escape valve for visibility is
 * `PRISMA_DEBUG=1`, which routes diagnostics to stderr. In normal
 * operation no telemetry-originating output ever reaches the user — the
 * parent's stdio map ignores our streams anyway, but we also gate
 * stderr writes behind the debug flag so the same binary is safe to
 * invoke directly outside the spawn flow.
 */
import { buildTelemetryEventFromProcess } from './enrich';
import { isParentToSenderPayload, type ParentToSenderPayload } from './payload';

const REQUEST_TIMEOUT_MS = 1500;

function debugLog(message: string, error?: unknown): void {
  if (process.env['PRISMA_DEBUG'] !== '1') return;
  if (error !== undefined) {
    process.stderr.write(`[cli-telemetry] ${message}: ${String(error)}\n`);
  } else {
    process.stderr.write(`[cli-telemetry] ${message}\n`);
  }
}

async function postEvent(payload: ParentToSenderPayload): Promise<void> {
  const event = await buildTelemetryEventFromProcess(payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(payload.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    debugLog(`sent event: status=${response.status}`);
  } catch (err) {
    debugLog('send failed', err);
  } finally {
    clearTimeout(timer);
  }
}

function exitClean(): void {
  // `process.disconnect()` lets the parent's `.disconnect()` complete
  // without lingering IPC handles when the parent is fast.
  try {
    process.disconnect?.();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.once('message', (message: unknown) => {
  if (!isParentToSenderPayload(message)) {
    debugLog('received malformed payload; exiting');
    exitClean();
    return;
  }
  postEvent(message)
    .catch((err) => debugLog('post threw', err))
    .finally(exitClean);
});

// Defensive: if the parent never sends a payload (or the IPC channel
// closes before `message` arrives), exit after a generous grace period
// so the child process is not stuck holding a handle.
const SENDER_IDLE_EXIT_MS = REQUEST_TIMEOUT_MS * 2;
setTimeout(exitClean, SENDER_IDLE_EXIT_MS).unref();
