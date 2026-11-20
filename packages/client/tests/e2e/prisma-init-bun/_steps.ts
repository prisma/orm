import { $ } from 'zx'

import { executeSteps } from '../_utils/executeSteps'

void executeSteps({
  setup: async () => {
    // We use pnpm because Bun has issues with installing transitive tarball dependencies
    await $`pnpm install`

    // Running `bunx prisma` or `bun run prisma` won't cut it.
    // See: https://github.com/oven-sh/bun/issues/3417#issuecomment-1927842420.
    await $`bun --bun run prisma init --debug`
  },
  test: async () => {
    await $`bun test`
  },
  finish: async () => {
    await $`echo "done"`
  },
  // keep: true, // keep docker open to debug it
})
