import { $ } from 'zx'

import { executeSteps } from '../_utils/executeSteps'

void executeSteps({
  setup: async () => {
    await $`pnpm install`
    await $`pnpm prisma generate --config prisma/custom-output.config.ts`
    await $`pnpm prisma generate --config prisma/default-output.config.ts`
  },
  test: async () => {
    await $`pnpm test`
  },
  finish: async () => {
    await $`echo "done"`
  },
})
