import type { PrismaConfigInternal } from '@prisma/config'
import type { BaseContext } from '@prisma/get-platform'
import * as colors from 'kleur/colors'

import { loadConfig } from '../../utils/loadConfig'

type ConfigContext = {
  config: () => Promise<PrismaConfigInternal>
  configDir: () => string
}

/**
 * Extends a jestContext with a function to get a PrismaConfig.
 * The config includes a configured migrate driver adapter based on the current test matrix.
 * Any prisma.config.ts file in the root of the test context fixture will be merged with the default config.
 * Use with jestContext e.g. via `const ctx = jestContext.new().add(configContextContributor()).assemble()`
 */
export const configContextContributor =
  <C extends BaseContext>() =>
  (c: C) => {
    const ctx = c as C & ConfigContext

    beforeEach(() => {
      ctx.config = async () => {
        const result = await loadConfig()
        if (result instanceof Error) {
          throw result
        }

        const { config, diagnostics } = result

        for (const diagnostic of diagnostics) {
          const lines: string[] = []
          diagnostic.value({
            log: (s) => lines.push(s),
            warn: (s) => lines.push(colors.yellow(s)),
            dim: (s) => colors.dim(s),
            link: (s) => colors.underline(s),
          })
          if (lines.length > 0) {
            throw new Error(lines.join('\n'))
          }
        }

        return config
      }

      ctx.configDir = () => ctx.fs.cwd()
    })

    return ctx
  }
