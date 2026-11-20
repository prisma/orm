import { $ } from 'zx'

import executeStepsModule from '../../_utils/executeSteps'

const { executeSteps } = executeStepsModule

void executeSteps({
  setup: async () => {
    await $`pnpm install`
    await $`pnpm prisma db push --force-reset`
    await $`pnpm prisma generate`
  },
  test: async () => {
    await $`pnpm exec prisma -v`
    await $`tsx src/test.ts`
    await $`pnpm tsc --noEmit`
  },
  finish: async () => {
    await $`echo "done"`
  },
  // keep: true, // keep docker open to debug it
})
