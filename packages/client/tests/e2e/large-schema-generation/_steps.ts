import { $ } from 'zx'

import { executeSteps } from '../_utils/executeSteps'

void executeSteps({
  setup: async () => {
    await $`pnpm install`
    await $`tsx src/generate-schema.ts`
  },
  test: async () => {
    await $`DEBUG='*' pnpm prisma generate 2>&1 | tee output.txt`
    // If generate succeeds and the DMMF fallback doesn't appear in the logs, either:
    // - The DMMF fallback is no longer being triggered when it should be, which would be a bug.
    // - `src/generate-schema.ts` needs to be updated with a higher `targetModelCount`
    await $`grep -q "falling back to buffered DMMF API" output.txt || exit 1`
  },
  finish: async () => {
    await $`echo "done"`
  },
  // keep: true, // Uncomment to keep the test environment for debugging
})
