import { DbPull } from '../../commands/DbPull'
import { describeMatrix, mongodbOnly } from '../__helpers__/conditionalTests'
import { createDefaultTestContext } from '../__helpers__/context'

const isMacOrWindowsCI = Boolean(process.env.CI) && ['darwin', 'win32'].includes(process.platform)
if (isMacOrWindowsCI) {
  jest.setTimeout(60_000)
}

const ctx = createDefaultTestContext()

describeMatrix(mongodbOnly, 'MongoDB', () => {
  if (isMacOrWindowsCI) {
    jest.setTimeout(60_000)
  }

  test('basic introspection', async () => {
    ctx.fixture('schema-only-mongodb')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(['--schema=./prisma/no-model.prisma'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": MongoDB database "tests-migrate" <location placeholder>

      - Introspecting based on datasource defined in prisma/no-model.prisma
      ✔ Introspected 1 model and 2 embedded documents and wrote them into prisma/no-model.prisma in XXXms
            
      *** WARNING ***

      The following fields had data stored in multiple types. Either use Json or normalize data to the wanted type:
        - Model: "users", field: "numberOrString1", original data type: "Json"

      The following fields had data stored in multiple types. Either use Json or normalize data to the wanted type:
        - Composite type: "UsersHobbies", field: "numberOrString2", chosen data type: "Json"
        - Composite type: "UsersHobbiesObjects", field: "numberOrString3", chosen data type: "Json"

      Run prisma generate to generate Prisma Client.
      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('introspection --force (existing models)', async () => {
    ctx.fixture('schema-only-mongodb')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(['--force'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": MongoDB database "tests-migrate" <location placeholder>

      - Introspecting based on datasource defined in prisma/schema.prisma
      ✔ Introspected 1 model and 2 embedded documents and wrote them into prisma/schema.prisma in XXXms
            
      *** WARNING ***

      The following fields had data stored in multiple types. Either use Json or normalize data to the wanted type:
        - Model: "users", field: "numberOrString1", original data type: "Json"

      The following fields had data stored in multiple types. Either use Json or normalize data to the wanted type:
        - Composite type: "UsersHobbies", field: "numberOrString2", chosen data type: "Json"
        - Composite type: "UsersHobbiesObjects", field: "numberOrString3", chosen data type: "Json"

      Run prisma generate to generate Prisma Client.
      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('introspection --print (no existing models)', async () => {
    ctx.fixture('schema-only-mongodb')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(
      ['--schema=./prisma/no-model.prisma', '--print'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
      }

      datasource my_db {
        provider = "mongodb"
      }

      type UsersHobbies {
        name            String
        /// Multiple data types found: String: 50%, Int: 50% out of 2 sampled entries
        numberOrString2 Json?
        objects         UsersHobbiesObjects[]
        tags            String[]
      }

      type UsersHobbiesObjects {
        name            String
        /// Multiple data types found: String: 50%, Int: 50% out of 2 sampled entries
        numberOrString3 Json
        tags            String[]
      }

      model users {
        id              String         @id @default(auto()) @map("_id") @my_db.ObjectId
        admin           Boolean
        email           String
        hobbies         UsersHobbies[]
        name            String
        /// Multiple data types found: String: 50%, Int: 50% out of 2 sampled entries
        numberOrString1 Json
      }

      "
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`
      "
      // *** WARNING ***
      // 
      // The following fields had data stored in multiple types. Either use Json or normalize data to the wanted type:
      //   - Model: "users", field: "numberOrString1", original data type: "Json"
      // 
      // The following fields had data stored in multiple types. Either use Json or normalize data to the wanted type:
      //   - Composite type: "UsersHobbies", field: "numberOrString2", chosen data type: "Json"
      //   - Composite type: "UsersHobbiesObjects", field: "numberOrString3", chosen data type: "Json"
      // "
    `)
  })

  test('introspection --print --composite-type-depth=0 (no existing models)', async () => {
    ctx.fixture('schema-only-mongodb')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(
      ['--schema=./prisma/no-model.prisma', '--print', '--composite-type-depth=0'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
      }

      datasource my_db {
        provider = "mongodb"
      }

      model users {
        id              String  @id @default(auto()) @map("_id") @my_db.ObjectId
        admin           Boolean
        email           String
        hobbies         Json[]
        name            String
        /// Multiple data types found: String: 50%, Int: 50% out of 2 sampled entries
        numberOrString1 Json
      }

      "
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`
      "
      // *** WARNING ***
      // 
      // The following fields had data stored in multiple types. Either use Json or normalize data to the wanted type:
      //   - Model: "users", field: "numberOrString1", original data type: "Json"
      // "
    `)
  })

  test('introspection --print --composite-type-depth=1 (no existing models)', async () => {
    ctx.fixture('schema-only-mongodb')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(
      ['--schema=./prisma/no-model.prisma', '--print', '--composite-type-depth=1'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
      }

      datasource my_db {
        provider = "mongodb"
      }

      type UsersHobbies {
        name            String
        /// Multiple data types found: String: 50%, Int: 50% out of 2 sampled entries
        numberOrString2 Json?
        objects         Json[]
        tags            String[]
      }

      model users {
        id              String         @id @default(auto()) @map("_id") @my_db.ObjectId
        admin           Boolean
        email           String
        hobbies         UsersHobbies[]
        name            String
        /// Multiple data types found: String: 50%, Int: 50% out of 2 sampled entries
        numberOrString1 Json
      }

      "
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`
      "
      // *** WARNING ***
      // 
      // The following fields had data stored in multiple types. Either use Json or normalize data to the wanted type:
      //   - Model: "users", field: "numberOrString1", original data type: "Json"
      // 
      // The following fields had data stored in multiple types. Either use Json or normalize data to the wanted type:
      //   - Composite type: "UsersHobbies", field: "numberOrString2", chosen data type: "Json"
      // "
    `)
  })

  test('introspection --force --composite-type-depth=-1 (existing models)', async () => {
    ctx.fixture('schema-only-mongodb')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(['--force', '--composite-type-depth=-1'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": MongoDB database "tests-migrate" <location placeholder>

      - Introspecting based on datasource defined in prisma/schema.prisma
      ✔ Introspected 1 model and 2 embedded documents and wrote them into prisma/schema.prisma in XXXms
            
      *** WARNING ***

      The following fields had data stored in multiple types. Either use Json or normalize data to the wanted type:
        - Model: "users", field: "numberOrString1", original data type: "Json"

      The following fields had data stored in multiple types. Either use Json or normalize data to the wanted type:
        - Composite type: "UsersHobbies", field: "numberOrString2", chosen data type: "Json"
        - Composite type: "UsersHobbiesObjects", field: "numberOrString3", chosen data type: "Json"

      Run prisma generate to generate Prisma Client.
      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('introspection --print --composite-type-depth=-1 (no existing models)', async () => {
    ctx.fixture('schema-only-mongodb')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(
      ['--schema=./prisma/no-model.prisma', '--print', '--composite-type-depth=-1'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
      }

      datasource my_db {
        provider = "mongodb"
      }

      type UsersHobbies {
        name            String
        /// Multiple data types found: String: 50%, Int: 50% out of 2 sampled entries
        numberOrString2 Json?
        objects         UsersHobbiesObjects[]
        tags            String[]
      }

      type UsersHobbiesObjects {
        name            String
        /// Multiple data types found: String: 50%, Int: 50% out of 2 sampled entries
        numberOrString3 Json
        tags            String[]
      }

      model users {
        id              String         @id @default(auto()) @map("_id") @my_db.ObjectId
        admin           Boolean
        email           String
        hobbies         UsersHobbies[]
        name            String
        /// Multiple data types found: String: 50%, Int: 50% out of 2 sampled entries
        numberOrString1 Json
      }

      "
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`
      "
      // *** WARNING ***
      // 
      // The following fields had data stored in multiple types. Either use Json or normalize data to the wanted type:
      //   - Model: "users", field: "numberOrString1", original data type: "Json"
      // 
      // The following fields had data stored in multiple types. Either use Json or normalize data to the wanted type:
      //   - Composite type: "UsersHobbies", field: "numberOrString2", chosen data type: "Json"
      //   - Composite type: "UsersHobbiesObjects", field: "numberOrString3", chosen data type: "Json"
      // "
    `)
  })

  test('introspection with --force', async () => {
    ctx.fixture('schema-only-mongodb')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(['--force'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": MongoDB database "tests-migrate" <location placeholder>

      - Introspecting based on datasource defined in prisma/schema.prisma
      ✔ Introspected 1 model and 2 embedded documents and wrote them into prisma/schema.prisma in XXXms
            
      *** WARNING ***

      The following fields had data stored in multiple types. Either use Json or normalize data to the wanted type:
        - Model: "users", field: "numberOrString1", original data type: "Json"

      The following fields had data stored in multiple types. Either use Json or normalize data to the wanted type:
        - Composite type: "UsersHobbies", field: "numberOrString2", chosen data type: "Json"
        - Composite type: "UsersHobbiesObjects", field: "numberOrString3", chosen data type: "Json"

      Run prisma generate to generate Prisma Client.
      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('re-introspection should error (not supported) (existing models)', async () => {
    ctx.fixture('schema-only-mongodb')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
      "Iterating on one schema using re-introspection with db pull is currently not supported with MongoDB provider.
      You can explicitly ignore and override your current local schema file with prisma db pull --force
      Some information will be lost (relations, comments, mapped fields, @ignore...), follow https://github.com/prisma/prisma/issues/9585 for more info."
    `)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": MongoDB database "tests-migrate" <location placeholder>
      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })
})
