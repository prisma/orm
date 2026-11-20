import { MigrateCommand } from '../commands/MigrateCommand'
import { createDefaultTestContext } from './__helpers__/context'

const ctx = createDefaultTestContext()

it('no params should return help', async () => {
  const commandInstance = MigrateCommand.new({}, 'prisma')
  const spy = jest.spyOn(commandInstance, 'help').mockImplementation(() => 'Help Me')

  await commandInstance.parse([], await ctx.config(), ctx.configDir())
  expect(spy).toHaveBeenCalledTimes(1)
  spy.mockRestore()
})

it('wrong flag', async () => {
  const commandInstance = MigrateCommand.new({}, 'prisma')
  const spy = jest.spyOn(commandInstance, 'help').mockImplementation(() => 'Help Me')

  await commandInstance.parse(['--something'], await ctx.config(), ctx.configDir())
  expect(spy).toHaveBeenCalledTimes(1)
  spy.mockRestore()
})

it('help flag', async () => {
  const commandInstance = MigrateCommand.new({}, 'prisma')
  const spy = jest.spyOn(commandInstance, 'help').mockImplementation(() => 'Help Me')

  await commandInstance.parse(['--help'], await ctx.config(), ctx.configDir())
  expect(spy).toHaveBeenCalledTimes(1)
  spy.mockRestore()
})

describe.each(['prisma', 'prisma7'] as const)('%s', (cliCommand) => {
  it('renders help with the selected executable', () => {
    const result = MigrateCommand.new({}, cliCommand).help()

    expect(result).toContain(`${cliCommand} migrate [command] [options]`)
    expect(result).toContain(`${cliCommand} migrate diff`)
    expect(result).not.toContain(`${cliCommand === 'prisma' ? 'prisma7' : 'prisma'} migrate [command] [options]`)
  })

  it('renders unknown-command help with the selected executable', async () => {
    const result = await MigrateCommand.new({}, cliCommand).parse(['doesnotexist'], await ctx.config(), ctx.configDir())
    const otherCliCommand = cliCommand === 'prisma' ? 'prisma7' : 'prisma'

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain(`${cliCommand} migrate [command] [options]`)
    expect((result as Error).message).toContain(`Unknown command \"doesnotexist\"`)
    expect((result as Error).message).not.toContain(`${otherCliCommand} migrate [command] [options]`)
  })
})
