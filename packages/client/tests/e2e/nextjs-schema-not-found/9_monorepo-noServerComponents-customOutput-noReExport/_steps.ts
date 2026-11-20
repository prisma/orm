import { $, cd } from 'zx'

import { executeSteps } from '../../_utils/executeSteps'
import { testNonServerComponents } from '../_shared/test'

void executeSteps({
  setup: async () => {
    await $`pnpm install`
    cd('packages/service')
    await $`pnpm prisma generate`
    await $`pnpm exec prisma db push --force-reset`
  },
  test: async () => {
    await testNonServerComponents()
  },
  finish: async () => {},
})
