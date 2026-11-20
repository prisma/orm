import { jestConsoleContext, jestContext } from '@prisma/get-platform'

import { printMessageAndExitIfUnsupportedNodeVersion } from '../../scripts/preinstall'

const ctx = jestContext.new().add(jestConsoleContext()).assemble()

it.each(['16.18.0', '18.20.8', '20.18.3', '22.11.0'] as const)(
  'should exit 1 and print a message when Node.js major version is lower than minimum - %s',
  (version) => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation()

    printMessageAndExitIfUnsupportedNodeVersion(version)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`
    "┌────────────────────────────────────────────────────────────────────┐
    │    Prisma only supports Node.js versions 20.19+, 22.12+, 24.0+.    │
    │    Please upgrade your Node.js version.                            │
    └────────────────────────────────────────────────────────────────────┘"
  `)

    expect(mockExit).toHaveBeenCalledWith(1)
    mockExit.mockRestore()
  },
)

it.each(['25.0.0', '30.1.0'] as const)(
  'should exit 1 and print a message when Node.js major version is higher than supported - %s',
  (version) => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation()

    printMessageAndExitIfUnsupportedNodeVersion(version)

    expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`
    "┌────────────────────────────────────────────────────────────────────┐
    │    Prisma only supports Node.js versions 20.19+, 22.12+, 24.0+.    │
    │    Please use a supported Node.js version.                         │
    └────────────────────────────────────────────────────────────────────┘"
  `)

    expect(mockExit).not.toHaveBeenCalled()
    mockExit.mockRestore()
  },
)

it.each(['20.19.5', '22.12.0', '22.20.0', '24.0.1', '24.10.0'] as const)(
  'should do nothing when Node.js version is supported - %s',
  (version) => {
    printMessageAndExitIfUnsupportedNodeVersion(version)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  },
)

it('should do nothing when Node.js version is supported - current', () => {
  printMessageAndExitIfUnsupportedNodeVersion(process.versions.node as `${number}.${number}.${number}`)

  expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
})
