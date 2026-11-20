import { $ } from 'zx'

import executeStepsModule from '../../_utils/executeSteps'

const { executeSteps } = executeStepsModule

void executeSteps({
  setup: async () => {
    await $`pnpm install`
    await $`pnpm prisma generate`
    await $`pnpm prisma db push --force-reset`
  },
  test: async () => {
    await $`pnpm tsoa routes`
  },
  finish: async () => {
    await $`echo "done"`
  },
  // keep: true, // keep docker open to debug it
})
