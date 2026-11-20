import { $, cd } from 'zx'

import { executeSteps } from '../_utils/executeSteps'

void executeSteps({
  setup: async () => {
    cd('simple-ext')
    await $`pnpm install`
    await $`pnpm run build`
    await $`pnpm pack`
    await $`ls -l`

    cd('..')
    await $`pnpm install`
    await $`pnpm prisma generate`
    await $`pnpm exec prisma db push --force-reset`
  },
  test: async () => {
    await $`pnpm exec tsc --noEmit`
    await $`pnpm exec jest`
  },
  finish: async () => {
    await $`echo "done"`
  },
  // keep: true, // keep docker open to debug it
})
