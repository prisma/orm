import { Datasource, defaultTestConfig, defineConfig, PrismaConfigInternal } from '@prisma/config'
import type { BaseContext } from '@prisma/get-platform'
import { type PrismaConfigWithDatasource, validatePrismaConfigWithDatasource } from '@prisma/internals'

type ConfigContext = {
  config: () => Promise<PrismaConfigInternal>
  configWithDatasource: () => Promise<PrismaConfigWithDatasource>
  datasource: () => Promise<Datasource | undefined>
  configFileName: () => string
  configDir: () => string

  setDatasource: (ds: Datasource) => void
  resetDatasource: () => void
  setConfigFile: (fileName: string | undefined) => void
  resetConfigFile: () => void
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
    let overrideDatasource: Datasource | undefined
    let overrideConfigFile: string | undefined

    beforeEach(() => {
      ctx.config = async () => {
        return {
          ...defaultTestConfig(),
          ...(await loadFixtureConfig(ctx)), // custom fixture config overwrites any defaults
          ...(overrideDatasource ? defineConfig({ datasource: overrideDatasource }) : {}),
        }
      }

      ctx.configWithDatasource = async () => {
        const config = await ctx.config()

        return validatePrismaConfigWithDatasource({ config, command: 'prisma test' })
      }

      ctx.datasource = async () => {
        const config = await ctx.config()
        return config.datasource
      }

      ctx.setDatasource = (ds) => {
        overrideDatasource = ds
      }

      ctx.resetDatasource = () => {
        overrideDatasource = undefined
      }

      ctx.setConfigFile = (fileName) => {
        overrideConfigFile = fileName
      }

      ctx.configFileName = () => overrideConfigFile ?? 'prisma.config.ts'

      ctx.resetConfigFile = () => {
        overrideConfigFile = undefined
      }

      ctx.configDir = () => {
        return ctx.fs.path(ctx.configFileName(), '..')
      }
    })

    afterEach(() => {
      ctx.resetDatasource()
      ctx.resetConfigFile()
    })

    return ctx
  }

async function loadFixtureConfig(ctx: BaseContext & ConfigContext) {
  // Note: This is a workaround to avoid issues with jest's module resolution.
  // If you used `loadConfigFromFile` directly, you'd observe the following error:
  // ```
  // [ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG]: A dynamic import callback was invoked without --experimental-vm-modules
  // ```
  if (!ctx.fs.exists(`${ctx.fs.cwd()}/${ctx.configFileName()}`)) return undefined
  return (await import(`${ctx.fs.cwd()}/${ctx.configFileName()}`)).default as PrismaConfigInternal
}
