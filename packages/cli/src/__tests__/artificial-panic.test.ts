import { jestContext } from '@prisma/get-platform'
import { serialize } from '@prisma/get-platform/src/test-utils/jestSnapshotSerializer'
import { getDMMF, isRustPanic } from '@prisma/internals'
import { DbPull } from '@prisma/migrate'

import { Format } from '../Format'
import { Validate } from '../Validate'
import { configContextContributor } from './_utils/config-context'

const ctx = jestContext.new().add(configContextContributor()).assemble()

function restoreEnvSnapshot(snapshot: NodeJS.ProcessEnv) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

/**
 * Note: under the hood, these artificial-panic tests uses the Wasm'd `getConfig` and `getDMMF` definitions
 */

describe('artificial-panic introspection', () => {
  // backup env vars
  const OLD_ENV = { ...process.env }

  afterEach(() => {
    // reset env vars to backup state
    restoreEnvSnapshot(OLD_ENV)
  })

  it('schema-engine', async () => {
    ctx.fixture('artificial-panic')
    expect.assertions(4)
    process.env.FORCE_PANIC_SCHEMA_ENGINE = '1'

    const command = DbPull.new('prisma')
    try {
      await command.parse(['--print'], await ctx.config())
    } catch (e) {
      expect(e).toMatchInlineSnapshot(`
        "Error in Schema engine.
        Reason: [/some/rust/path:0:0] This is the debugPanic artificial panic
        "
      `)
      expect(isRustPanic(e)).toBe(true)
      expect(e.rustStack).toBeTruthy()
      expect(e).toMatchObject({
        area: 'LIFT_CLI',
      })
    }
  })
})

describe('artificial-panic formatter', () => {
  const OLD_ENV = { ...process.env }

  afterEach(() => {
    restoreEnvSnapshot(OLD_ENV)
  })

  it('formatter', async () => {
    ctx.fixture('artificial-panic')
    expect.assertions(3)
    process.env.FORCE_PANIC_PRISMA_SCHEMA = '1'

    const command = new Format('prisma')
    try {
      await command.parse([], await ctx.config())
    } catch (e) {
      expect(serialize(e.message)).toMatchInlineSnapshot(`
        ""RuntimeError: panicked at prisma-schema-wasm/src/lib.rs:0:0:
        This is the panic triggered by \`prisma_fmt::debug_panic()\`""
      `)
      expect(isRustPanic(e)).toBe(true)
      expect(e.rustStack).toBeTruthy()
    }
  })
})

describe('artificial-panic get-config', () => {
  const OLD_ENV = { ...process.env }

  afterEach(() => {
    restoreEnvSnapshot(OLD_ENV)
  })

  it('get-config', async () => {
    ctx.fixture('artificial-panic')
    expect.assertions(3)
    process.env.FORCE_PANIC_GET_CONFIG = '1'

    const command = new Validate('prisma')
    try {
      await command.parse([], await ctx.config())
    } catch (e) {
      expect(serialize(e.message)).toMatchInlineSnapshot(`
        ""RuntimeError: panicked at prisma-schema-wasm/src/lib.rs:0:0:
        This is the panic triggered by \`prisma_fmt::debug_panic()\`""
      `)
      expect(isRustPanic(e)).toBe(true)
      expect(e.rustStack).toBeTruthy()
    }
  })
})

describe('artificial-panic validate', () => {
  const OLD_ENV = { ...process.env }

  afterEach(() => {
    restoreEnvSnapshot(OLD_ENV)
  })

  it('validate', async () => {
    ctx.fixture('artificial-panic')
    expect.assertions(3)
    process.env.FORCE_PANIC_GET_DMMF = '1'

    const command = new Validate('prisma')
    try {
      await command.parse([], await ctx.config())
    } catch (e) {
      expect(serialize(e.message)).toMatchInlineSnapshot(`
        ""RuntimeError: panicked at prisma-schema-wasm/src/lib.rs:0:0:
        This is the panic triggered by \`prisma_fmt::debug_panic()\`""
      `)
      expect(isRustPanic(e)).toBe(true)
      expect(e.rustStack).toBeTruthy()
    }
  })

  it('format', async () => {
    ctx.fixture('artificial-panic')
    expect.assertions(3)
    process.env.FORCE_PANIC_GET_DMMF = '1'

    const command = new Format('prisma')
    try {
      await command.parse([], await ctx.config())
    } catch (e) {
      expect(serialize(e.message)).toMatchInlineSnapshot(`
        ""RuntimeError: panicked at prisma-schema-wasm/src/lib.rs:0:0:
        This is the panic triggered by \`prisma_fmt::debug_panic()\`""
      `)
      expect(isRustPanic(e)).toBe(true)
      expect(e.rustStack).toBeTruthy()
    }
  })
})

describe('artificial-panic getDMMF', () => {
  const OLD_ENV = { ...process.env }

  afterEach(() => {
    restoreEnvSnapshot(OLD_ENV)
  })

  it('getDMMF', async () => {
    ctx.fixture('artificial-panic')
    expect.assertions(3)
    process.env.FORCE_PANIC_GET_DMMF = '1'

    try {
      await getDMMF({
        datamodel: /* prisma */ `generator client {
  provider = "prisma-client-js"
}`,
      })
    } catch (e) {
      expect(serialize(e.message)).toMatchInlineSnapshot(`
        ""RuntimeError: panicked at prisma-schema-wasm/src/lib.rs:0:0:
        This is the panic triggered by \`prisma_fmt::debug_panic()\`""
      `)
      expect(isRustPanic(e)).toBe(true)
      expect(e.rustStack).toBeTruthy()
    }
  })
})
