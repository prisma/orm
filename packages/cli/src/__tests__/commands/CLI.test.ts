import { defaultTestConfig } from '@prisma/config'
import { jestConsoleContext, jestContext } from '@prisma/get-platform'

import { CLI } from '../../CLI'
import { Validate } from '../../Validate'

const ctx = jestContext.new().add(jestConsoleContext()).assemble()

function createCLI(download = jest.fn()) {
  return CLI.new(
    {
      // init: Init.new('prisma'),
      // migrate: MigrateCommand.new({
      //   diff: MigrateDiff.new(),
      //   dev: MigrateDev.new(),
      //   status: MigrateStatus.new('prisma'),
      //   resolve: MigrateResolve.new(),
      //   reset: MigrateReset.new(),
      //   deploy: MigrateDeploy.new(),
      // }),
      // db: DbCommand.new({
      //   pull: DbPull.new(),
      //   push: DbPush.new(),
      //   // drop: DbDrop.new('prisma'),
      //   seed: DbSeed.new(),
      // }),
      // dev: Dev.new(),
      // generate: Generate.new('prisma'),
      // version: Version.new(),
      validate: Validate.new('prisma'),
      // format: Format.new('prisma'),
      // telemetry: Telemetry.new(),
    },
    ['version', 'init', 'migrate', 'db', 'dev', 'generate', 'validate', 'format', 'telemetry'],
    download,
    'prisma',
  )
}

describe('CLI', () => {
  const download = jest.fn()
  let cliInstance: CLI

  beforeEach(() => {
    cliInstance = createCLI(download)
  })

  afterEach(() => {
    download.mockClear()
  })

  describe('ensureNeededBinariesExist', () => {
    it('should download schema engine', async () => {
      ctx.fixture('ensure-needed-binaries-exist')

      await cliInstance.parse(['validate', '--schema', './using-query-compiler.prisma'], defaultTestConfig())
      expect(download).toHaveBeenCalledWith(
        expect.objectContaining({
          binaries: {
            'schema-engine': expect.any(String),
          },
        }),
      )
    })
  })

  it('no params should return help', async () => {
    const spy = jest.spyOn(cliInstance, 'help').mockImplementation(() => 'Help Me')

    await cliInstance.parse([], defaultTestConfig())
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('wrong flag', async () => {
    const spy = jest.spyOn(cliInstance, 'help').mockImplementation(() => 'Help Me')

    await cliInstance.parse(['--something'], defaultTestConfig())
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('help flag', async () => {
    const spy = jest.spyOn(cliInstance, 'help').mockImplementation(() => 'Help Me')

    await cliInstance.parse(['--help'], defaultTestConfig())
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('unknown command', async () => {
    await expect(cliInstance.parse(['doesnotexist'], defaultTestConfig())).resolves.toThrow()
  })
})
