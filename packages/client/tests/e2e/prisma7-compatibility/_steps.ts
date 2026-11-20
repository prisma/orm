import { $ } from 'zx'

import { executeSteps } from '../_utils/executeSteps'

void executeSteps({
  setup: async () => {
    await $`pnpm install`
  },
  test: async () => {
    await $`pnpm exec vitest run`
  },
  finish: async () => {
    await $`echo "done"`
  },
})
