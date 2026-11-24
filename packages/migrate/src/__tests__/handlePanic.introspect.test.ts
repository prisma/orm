import path from 'path'

import { DbPull } from '../commands/DbPull'
import { createDefaultTestContext } from './__helpers__/context'

const ctx = createDefaultTestContext()

describe('introspection panic', () => {
  test('force panic', async () => {
    expect.assertions(1)
    process.env.FORCE_PANIC_SCHEMA_ENGINE = '1'
    ctx.fixture(path.join('introspection', 'sqlite'))

    const introspect = DbPull.new('prisma')
    try {
      await introspect.parse(['--print'], await ctx.config(), ctx.configDir())
    } catch (e) {
      expect(e.message).toContain('This is the debugPanic artificial panic')
    }
  })
})
