import { $ } from 'zx'

import { executeSteps } from '../_utils/executeSteps'

class ExpectedError extends Error {}

void executeSteps({
  setup: async () => {
    await $`pnpm install`
  },
  test: async () => {
    // using `process.env['UNDEFINED_VARIABLE']` in `config.datasource.url` + `prisma generate` should succeed
    await $`pnpm prisma generate --config ./src/prisma.config.process-env.ts`

    // using `process.env['UNDEFINED_VARIABLE']` helper in `config.datasource.url` + `prisma db push` should fail
    try {
      await $`pnpm prisma db push --config ./src/prisma.config.process-env.ts`
      throw new ExpectedError('The command should have failed but it succeeded.')
    } catch (e: any) {
      console.error(e)
      if (e instanceof ExpectedError) {
        throw e
      }
    }

    // using `env('UNDEFINED_VARIABLE')` helper in `config.datasource.url` should fail
    try {
      await $`pnpm prisma generate --config ./src/prisma.config.using-env-helper.ts`
      throw new ExpectedError('The command should have failed but it succeeded.')
    } catch (e: any) {
      console.error(e)
      if (e instanceof ExpectedError) {
        throw e
      }
    }
  },
  finish: async () => {
    await $`echo "done"`
  },
  // keep: true, // keep docker open to debug it
})
