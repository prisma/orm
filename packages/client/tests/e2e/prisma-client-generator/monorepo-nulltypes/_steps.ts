import { $ } from 'zx'

import { executeSteps } from '../../_utils/executeSteps'

void executeSteps({
  setup: async () => {
    await $`pnpm install`
    await $`pnpm -F app exec prisma db push --force-reset`
    await $`pnpm -F app exec prisma generate`
  },
  test: async () => {
    await $`pnpm -F app exec tsc --noEmit`
    await $`pnpm -F app exec prisma -v`
    await $`cd app && tsx src/test`
  },
  finish: async () => {
    await $`echo "done"`
  },
  // keep: true, // keep docker open to debug it
})
