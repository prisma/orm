import timers from 'node:timers/promises'

import { $ } from 'zx'

import { executeSteps } from '../_utils/executeSteps'
import { retry } from '../_utils/retry'
import { stopProcess, waitForWranglerReady } from '../_utils/wrangler'

void executeSteps({
  setup: async () => {
    await $`pnpm install`
    await $`pnpm prisma generate`
  },
  test: async () => {
    const { stdout } = await retry(async () => {
      const wranglerProcess = $`pnpm wrangler dev --ip 127.0.0.1 --port 8787 src/index.ts`.nothrow()

      try {
        await waitForWranglerReady(wranglerProcess)

        await timers.setTimeout(1000)

        return await $`curl http://localhost:8787/ -s`
      } finally {
        await stopProcess(wranglerProcess).catch(() => {})
      }
    }, 3)

    const expected =
      '{"Role":{"USER":"USER","ADMIN":"ADMIN"},"ModelName":{"User":"User","Post":"Post","Profile":"Profile"}}'

    if (!stdout.includes(expected)) {
      throw new Error('Expected to fetch the enum values')
    } else {
      console.log('Success!')
    }
  },
  finish: async () => {
    await $`echo "done"`
  },
})
