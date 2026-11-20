import { $ } from 'zx'

import { executeSteps } from '../_utils/executeSteps'

void executeSteps({
  setup: async () => {
    await $`pnpm install`
    await $`pnpm prisma generate`
  },
  test: async () => {
    await $`pnpm exec jest`
  },
  finish: async () => {
    await $`echo "done"`
  },
})
