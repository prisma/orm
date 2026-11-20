import { $, cd } from 'zx'

import { executeSteps } from '../../_utils/executeSteps'
import { testServerComponents } from '../_shared/test'

void executeSteps({
  setup: async () => {
    await $`pnpm install`
    cd('packages/db')
    await $`pnpm exec prisma db push --force-reset`
    await $`pnpm exec prisma generate`
    cd('../service')
  },
  test: async () => {
    await testServerComponents()
  },
  finish: async () => {},
})
