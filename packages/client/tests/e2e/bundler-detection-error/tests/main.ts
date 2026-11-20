import { $ } from 'zx'

const consoleMock = jest.spyOn(global.console, 'warn').mockImplementation()

afterEach(() => {
  consoleMock.mockClear()
})

test('bundled prisma client will re-use the schema.prisma via cwd', async () => {
  const { somePrismaCall } = require('../dist/index.js')

  const user = await somePrismaCall('john@doe.io')

  expect(user).not.toBeNull()
  expect(user).not.toBeUndefined()
})

// ! this test must be run last because it deletes the generated client
test('bundled prisma client will not fail if generated client is gone', async () => {
  await $`rm -rf generated`

  const { somePrismaCall } = require('../dist/index.js')

  const user = await somePrismaCall('john-2@doe.io')
  expect(user).not.toBeNull()
  expect(user).not.toBeUndefined()
})

export {}
