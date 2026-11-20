import { DbPull } from '../../commands/DbPull'
import { describeMatrix, noDriverAdapters, sqliteOnly } from '../__helpers__/conditionalTests'
import { createDefaultTestContext } from '../__helpers__/context'

const isMacOrWindowsCI = Boolean(process.env.CI) && ['darwin', 'win32'].includes(process.platform)
if (isMacOrWindowsCI) {
  jest.setTimeout(60_000)
}

const ctx = createDefaultTestContext()

describeMatrix({ providers: { d1: true } }, 'D1', () => {
  const urlValueRegex = /url\s*=\s*".*"/

  test('should succeed with listLocalDatabases() when a single local Cloudflare D1 database exists', async () => {
    ctx.fixture('cloudflare-d1-one-db')

    const introspect = DbPull.new('prisma')
    const result = introspect.parse(['--print'], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    // Example values:
    // Windows
    // 'file:.wrangler//state//v3//d1//miniflare-D1DatabaseObject//5d11bcce386042472d19a6a4f58e40041ebc5932c972e1449cbf404f3e3c4a7a.sqlite'
    // macOS
    // 'file:.wrangler/state/v3/d1/miniflare-D1DatabaseObject/5d11bcce386042472d19a6a4f58e40041ebc5932c972e1449cbf404f3e3c4a7a.sqlite'
    expect(ctx.normalizedCapturedStdout().replace(urlValueRegex, 'url = "REPLACED_BY_TEST"')).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
      }

      datasource db {
        provider = "sqlite"
      }

      model Post {
        id       Int    @id @default(autoincrement())
        title    String
        authorId Int
        User     User   @relation(fields: [authorId], references: [id])
      }

      model User {
        id     Int     @id @default(autoincrement())
        email  String  @unique
        count1 Int
        name   String?
        Post   Post[]
      }

      "
    `)
  })

  test('should succeed when reintrospecting with listLocalDatabases() when a single local Cloudflare D1 database exists', async () => {
    ctx.fixture('re-introspection/sqlite/cloudflare-d1-one-db')

    const introspect = DbPull.new('prisma')
    const result = introspect.parse([], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": SQLite database "5d11bcce386042472d19a6a4f58e40041ebc5932c972e1449cbf404f3e3c4a7a.sqlite" <location placeholder>

      - Introspecting based on datasource defined in prisma/schema.prisma
      ✔ Introspected 2 models and wrote them into prisma/schema.prisma in XXXms
            
      Run prisma generate to generate Prisma Client.
      "
    `)
  })
})

describeMatrix(sqliteOnly, 'common/sqlite', () => {
  test('basic introspection', async () => {
    ctx.fixture('introspection/sqlite')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(['--print'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
      }

      datasource db {
        provider = "sqlite"
      }

      model Post {
        authorId  Int
        content   String?
        createdAt DateTime @default(now())
        id        Int      @id @default(autoincrement())
        published Boolean  @default(false)
        title     String
        author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
      }

      model Profile {
        bio    String?
        id     Int     @id @default(autoincrement())
        userId Int     @unique(map: "Profile.userId")
        user   User    @relation(fields: [userId], references: [id], onDelete: Cascade)
      }

      model User {
        email   String   @unique(map: "User.email")
        id      Int      @id @default(autoincrement())
        name    String?
        posts   Post[]
        profile Profile?
      }

      "
    `)
  })

  test('introspection --force', async () => {
    ctx.fixture('introspection/sqlite')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(['--print', '--force'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
      }

      datasource db {
        provider = "sqlite"
      }

      model Post {
        authorId  Int
        content   String?
        createdAt DateTime @default(now())
        id        Int      @id @default(autoincrement())
        published Boolean  @default(false)
        title     String
        User      User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
      }

      model Profile {
        bio    String?
        id     Int     @id @default(autoincrement())
        userId Int     @unique(map: "Profile.userId")
        User   User    @relation(fields: [userId], references: [id], onDelete: Cascade)
      }

      model User {
        email   String   @unique(map: "User.email")
        id      Int      @id @default(autoincrement())
        name    String?
        Post    Post[]
        Profile Profile?
      }

      "
    `)
  })

  describeMatrix(noDriverAdapters, 'using classic engine', () => {
    test('basic introspection with config', async () => {
      ctx.fixture('introspection/sqlite')
      ctx.setDatasource({
        url: 'file:./dev.db',
      })

      const introspect = DbPull.new('prisma')
      const result = introspect.parse(['--print'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toBe('')

      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "generator client {
          provider = "prisma-client-js"
        }

        datasource db {
          provider = "sqlite"
        }

        model Post {
          authorId  Int
          content   String?
          createdAt DateTime @default(now())
          id        Int      @id @default(autoincrement())
          published Boolean  @default(false)
          title     String
          author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
        }

        model Profile {
          bio    String?
          id     Int     @id @default(autoincrement())
          userId Int     @unique(map: "Profile.userId")
          user   User    @relation(fields: [userId], references: [id], onDelete: Cascade)
        }

        model User {
          email   String   @unique(map: "User.email")
          id      Int      @id @default(autoincrement())
          name    String?
          posts   Post[]
          profile Profile?
        }

        "
      `)
    })

    test('basic introspection with schema missing file: prefix should fail', async () => {
      ctx.fixture('introspection/sqlite')
      ctx.setDatasource({
        url: 'withoutfileprefix.db',
      })

      const introspect = DbPull.new('prisma')
      const result = introspect.parse(['--print'], await ctx.config(), ctx.configDir())

      // TODO: this error is not entirely correct: the invalid URL is in the config file,
      // not in the datasource block. The message needs to be updated when removing the
      // `url` property from the PSL.
      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
        "P1013

        The provided database string is invalid. \`datasource.url\` in \`prisma.config.ts\` is invalid: must start with the protocol \`file:\`.
        "
      `)

      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "
        "
      `)
    })

    test('--url overrides config datasource URL when datasource exists in config', async () => {
      ctx.fixture('introspection/sqlite')
      ctx.setDatasource({
        url: 'file:./other.db',
      })

      const introspect = DbPull.new('prisma')
      const result = introspect.parse(['--print', '--url=file:./dev.db'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toBe('')

      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "generator client {
          provider = "prisma-client-js"
        }

        datasource db {
          provider = "sqlite"
        }

        model Post {
          authorId  Int
          content   String?
          createdAt DateTime @default(now())
          id        Int      @id @default(autoincrement())
          published Boolean  @default(false)
          title     String
          author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
        }

        model Profile {
          bio    String?
          id     Int     @id @default(autoincrement())
          userId Int     @unique(map: "Profile.userId")
          user   User    @relation(fields: [userId], references: [id], onDelete: Cascade)
        }

        model User {
          email   String   @unique(map: "User.email")
          id      Int      @id @default(autoincrement())
          name    String?
          posts   Post[]
          profile Profile?
        }

        "
      `)
    })

    test('--url works when no datasource exists in config', async () => {
      ctx.fixture('introspection/sqlite')

      const introspect = DbPull.new('prisma')
      const result = introspect.parse(['--print', '--url=file:./dev.db'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toBe('')

      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "generator client {
          provider = "prisma-client-js"
        }

        datasource db {
          provider = "sqlite"
        }

        model Post {
          authorId  Int
          content   String?
          createdAt DateTime @default(now())
          id        Int      @id @default(autoincrement())
          published Boolean  @default(false)
          title     String
          author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
        }

        model Profile {
          bio    String?
          id     Int     @id @default(autoincrement())
          userId Int     @unique(map: "Profile.userId")
          user   User    @relation(fields: [userId], references: [id], onDelete: Cascade)
        }

        model User {
          email   String   @unique(map: "User.email")
          id      Int      @id @default(autoincrement())
          name    String?
          posts   Post[]
          profile Profile?
        }

        "
      `)
    })
  })

  it('should succeed when schema and db do match', async () => {
    ctx.fixture('introspect')
    const result = DbPull.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.log'].mock.calls.join('\n').replace(/\d{2,3}ms/, 'XXms')).toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": SQLite database "dev.db" <location placeholder>

      - Introspecting based on datasource defined in prisma/schema.prisma
      ✔ Introspected 3 models and wrote them into prisma/schema.prisma in XXXms
            
      Run prisma generate to generate Prisma Client.
      "
    `)
  })

  it('should succeed and keep changes to valid schema and output warnings', async () => {
    ctx.fixture('introspect')
    const result = DbPull.new('prisma').parse(
      ['--schema=./prisma/reintrospection.prisma'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": SQLite database "dev.db" <location placeholder>

      - Introspecting based on datasource defined in prisma/reintrospection.prisma
      ✔ Introspected 3 models and wrote them into prisma/reintrospection.prisma in XXXms
            
      *** WARNING ***

      These models were enriched with \`@@map\` information taken from the previous Prisma schema:
        - "AwesomeNewPost"
        - "AwesomeProfile"
        - "AwesomeUser"

      Run prisma generate to generate Prisma Client.
      "
    `)

    expect(ctx.fs.read('prisma/reintrospection.prisma')).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
        output   = "../generated/client"
      }

      datasource db {
        provider = "sqlite"
      }

      model AwesomeUser {
        email    String           @unique(map: "User.email")
        id       Int              @id @default(autoincrement())
        name     String?
        newPosts AwesomeNewPost[]
        profile  AwesomeProfile?

        @@map("User")
      }

      model AwesomeNewPost {
        authorId  Int
        content   String?
        createdAt DateTime    @default(now())
        id        Int         @id @default(autoincrement())
        published Boolean     @default(false)
        title     String
        author    AwesomeUser @relation(fields: [authorId], references: [id], onDelete: Cascade)

        @@map("Post")
      }

      model AwesomeProfile {
        bio    String?
        id     Int         @id @default(autoincrement())
        userId Int         @unique(map: "Profile.userId")
        user   AwesomeUser @relation(fields: [userId], references: [id], onDelete: Cascade)

        @@map("Profile")
      }
      "
    `)
  })

  it('should succeed and keep changes to valid schema and output warnings when using --print', async () => {
    ctx.fixture('introspect')
    const originalSchema = ctx.fs.read('prisma/reintrospection.prisma')
    const result = DbPull.new('prisma').parse(
      ['--print', '--schema=./prisma/reintrospection.prisma'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
        output   = "../generated/client"
      }

      datasource db {
        provider = "sqlite"
      }

      model AwesomeUser {
        email    String           @unique(map: "User.email")
        id       Int              @id @default(autoincrement())
        name     String?
        newPosts AwesomeNewPost[]
        profile  AwesomeProfile?

        @@map("User")
      }

      model AwesomeNewPost {
        authorId  Int
        content   String?
        createdAt DateTime    @default(now())
        id        Int         @id @default(autoincrement())
        published Boolean     @default(false)
        title     String
        author    AwesomeUser @relation(fields: [authorId], references: [id], onDelete: Cascade)

        @@map("Post")
      }

      model AwesomeProfile {
        bio    String?
        id     Int         @id @default(autoincrement())
        userId Int         @unique(map: "Profile.userId")
        user   AwesomeUser @relation(fields: [userId], references: [id], onDelete: Cascade)

        @@map("Profile")
      }

      "
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`
      "
      // *** WARNING ***
      // 
      // These models were enriched with \`@@map\` information taken from the previous Prisma schema:
      //   - "AwesomeNewPost"
      //   - "AwesomeProfile"
      //   - "AwesomeUser"
      // "
    `)

    expect(ctx.fs.read('prisma/reintrospection.prisma')).toStrictEqual(originalSchema)
  })

  it('should succeed when schema and db do not match', async () => {
    ctx.fixture('existing-db-histories-diverge')
    const result = DbPull.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      - Introspecting based on datasource defined in prisma/schema.prisma
      ✔ Introspected 3 models and wrote them into prisma/schema.prisma in XXXms
            
      Run prisma generate to generate Prisma Client.
      "
    `)
  })

  it('should fail when db is missing', async () => {
    ctx.fixture('schema-only-sqlite')
    const result = DbPull.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
      "
      P1003 The introspected database does not exist:

      prisma db pull could not create any models in your schema.prisma file and you will not be able to generate Prisma Client with the prisma generate command.

      To fix this, you have two options:

      - manually create a database.
      - make sure the database connection URL inside the datasource block in schema.prisma points to an existing database.

      Then you can run prisma db pull again.
      "
    `)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      - Introspecting based on datasource defined in prisma/schema.prisma
      ✖ Introspecting based on datasource defined in prisma/schema.prisma
      "
    `)
  })

  it('should fail when db is empty', async () => {
    ctx.fixture('schema-only-sqlite')
    ctx.fs.write('dev.db', '')
    const result = DbPull.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
      "
      P4001 The introspected database was empty:

      prisma db pull could not create any models in your schema.prisma file and you will not be able to generate Prisma Client with the prisma generate command.

      To fix this, you have two options:

      - manually create a table in your database.
      - make sure the database connection URL inside the datasource block in schema.prisma points to a database that is not empty (it must contain at least one table).

      Then you can run prisma db pull again.
      "
    `)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      - Introspecting based on datasource defined in prisma/schema.prisma
      ✖ Introspecting based on datasource defined in prisma/schema.prisma
      "
    `)
  })

  it('should fail when Prisma schema is missing', async () => {
    ctx.fixture('valid-config-only')
    const result = DbPull.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
      "Could not find a schema.prisma file that is required for this command.
      You can either provide it with --schema, set its path in the \`schema\` property in your Prisma Config file, or put it into the default location ./prisma/schema.prisma https://pris.ly/d/prisma-schema-location"
    `)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`""`)
  })

  it('should fail when schema is invalid', async () => {
    ctx.fixture('introspect')
    const result = DbPull.new('prisma').parse(['--schema=./prisma/invalid.prisma'], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
      "P1012

      error: Error validating model "something": Each model must have at least one unique criteria that has only required fields. Either mark a single field with \`@id\`, \`@unique\` or add a multi field criterion with \`@@id([])\` or \`@@unique([])\` to the model.
        -->  prisma/invalid.prisma:10
         | 
       9 | 
      10 | model something {
      11 |   id Int
      12 | }
         | 


      Introspection failed as your current Prisma schema file is invalid

      Please fix your current schema manually (using either prisma validate or the Prisma VS Code extension to understand what's broken and confirm you fixed it), and then run this command again.
      Or run this command with the --force flag to ignore your current schema and overwrite it. All local modifications will be lost.
      "
    `)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": SQLite database "dev.db" <location placeholder>

      - Introspecting based on datasource defined in prisma/invalid.prisma
      ✖ Introspecting based on datasource defined in prisma/invalid.prisma

      "
    `)
  })

  it('should succeed when schema is invalid and using --force', async () => {
    ctx.fixture('introspect')

    const result = DbPull.new('prisma').parse(
      ['--schema=./prisma/invalid.prisma', '--force'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": SQLite database "dev.db" <location placeholder>

      - Introspecting based on datasource defined in prisma/invalid.prisma
      ✔ Introspected 3 models and wrote them into prisma/invalid.prisma in XXXms
            
      Run prisma generate to generate Prisma Client.
      "
    `)

    expect(ctx.fs.read('prisma/invalid.prisma')).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
        output   = "../generated/client"
      }

      datasource db {
        provider = "sqlite"
      }

      model Post {
        authorId  Int
        content   String?
        createdAt DateTime @default(now())
        id        Int      @id @default(autoincrement())
        published Boolean  @default(false)
        title     String
        User      User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
      }

      model Profile {
        bio    String?
        id     Int     @id @default(autoincrement())
        userId Int     @unique(map: "Profile.userId")
        User   User    @relation(fields: [userId], references: [id], onDelete: Cascade)
      }

      model User {
        email   String   @unique(map: "User.email")
        id      Int      @id @default(autoincrement())
        name    String?
        Post    Post[]
        Profile Profile?
      }
      "
    `)
  })
})
