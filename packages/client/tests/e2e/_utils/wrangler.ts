import { createInterface } from 'node:readline/promises'

import type { ProcessPromise } from 'zx'

/**
 * Waits for Wrangler to report that it's ready by monitoring stdout for the "Ready" message.
 * @param processPromise The Wrangler process promise
 * @throws Error if stdout is not available, timeout occurs, or stdout closes before readiness
 */
export async function waitForWranglerReady(processPromise: ProcessPromise) {
  const stdout = processPromise.stdout

  if (!stdout) {
    throw new Error('Wrangler stdout is not available; cannot detect readiness')
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort(new Error('Timed out waiting for wrangler to report readiness'))
  }, 30_000)

  const rl = createInterface({ input: stdout, crlfDelay: Infinity })

  try {
    controller.signal.throwIfAborted()

    for await (const line of rl) {
      controller.signal.throwIfAborted()

      if (line.includes('Ready')) {
        return
      }
    }

    throw new Error('Wrangler stdout closed before reporting readiness')
  } catch (error) {
    if (controller.signal.aborted) {
      throw controller.signal.reason as Error
    }

    throw error
  } finally {
    clearTimeout(timeoutId)
    rl.close()
    stdout.resume()
  }
}

/**
 * Stops a Wrangler process gracefully by sending SIGINT and waiting for it to exit.
 * @param processPromise The Wrangler process promise to stop
 */
export async function stopProcess(processPromise: ProcessPromise) {
  await processPromise.kill('SIGINT')
  await processPromise
}
