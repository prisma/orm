import timers from 'node:timers/promises'

import { $ } from 'zx'

import { executeSteps } from '../_utils/executeSteps'
import { stopProcess, waitForWranglerReady } from '../_utils/wrangler'

void executeSteps({
  setup: async () => {
    await $`pnpm install`
    await $`pnpm prisma generate`
  },
  test: async () => {
    const wranglerProcess = $`pnpm wrangler dev --ip 127.0.0.1 --port 8787`.nothrow()

    try {
      await waitForWranglerReady(wranglerProcess)

      await timers.setTimeout(1000)

      await $`pnpm exec jest`
    } finally {
      await stopProcess(wranglerProcess).catch(() => {})
    }
  },
  finish: async () => {
    await $`echo "done"`
  },
  // keep: true, // keep docker open to debug it
})
