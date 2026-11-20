import { providersSupportingRelationJoins } from '../relation-load-strategy/_common'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite((suiteConfig, _suiteMeta, _clientMeta, cliMeta) => {
  test('include and select are used at the same time', async () => {
    // @ts-expect-error
    const result = prisma.user.findMany({
      select: {},
      include: {},
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.findMany()\` invocation in
        /client/tests/functional/query-validation/tests.ts:0:0

           XX testMatrix.setupTestSuite((suiteConfig, _suiteMeta, _clientMeta, cliMeta) => {
           XX   test('include and select are used at the same time', async () => {
          XX     // @ts-expect-error
        → XX     const result = prisma.user.findMany({
                   select: {},
                   ~~~~~~
                   include: {}
                   ~~~~~~~
                 })

        Please either use \`include\` or \`select\`, but not both at the same time."
      `)
  })

  test('include used on scalar field', async () => {
    const result = prisma.user.findMany({
      // @ts-expect-error
      include: { id: true },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.findMany()\` invocation in
        /client/tests/functional/query-validation/tests.ts:0:0

          XX })
          XX 
          XX test('include used on scalar field', async () => {
        → XX   const result = prisma.user.findMany({
                 include: {
                   id: true,
                   ~~
               ?   organization?: true
                 }
               })

        Invalid scalar field \`id\` for include statement on model User. Available options are marked with ?.
        Note that include statements only accept relation fields."
      `)
  })

  test('undefined within array', async () => {
    const result = prisma.user.findMany({
      where: {
        OR: [
          // @ts-expect-error
          undefined,
        ],
      },
    })
    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.findMany()\` invocation in
        /client/tests/functional/query-validation/tests.ts:0:0

          XX })
          XX 
          XX test('undefined within array', async () => {
        → XX   const result = prisma.user.findMany({
                 where: {
                   OR: [
                     undefined
                     ~~~~~~~~~
                   ]
                 }
               })

        Invalid value for argument \`OR[0]\`: Can not use \`undefined\` value within array. Use \`null\` or filter out \`undefined\` values."
      `)
  })

  test('unknown selection field', async () => {
    const result = prisma.user.findMany({
      select: {
        // @ts-expect-error
        notThere: true,
      },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.findMany()\` invocation in
        /client/tests/functional/query-validation/tests.ts:0:0

          XX })
          XX 
          XX test('unknown selection field', async () => {
        → XX   const result = prisma.user.findMany({
                 select: {
                   notThere: true,
                   ~~~~~~~~
               ?   id?: true,
               ?   email?: true,
               ?   name?: true,
               ?   createdAt?: true,
               ?   published?: true,
               ?   organizationId?: true,
               ?   organization?: true
                 }
               })

        Unknown field \`notThere\` for select statement on model \`User\`. Available options are marked with ?."
      `)
  })

  test('empty selection', async () => {
    const result = prisma.user.findMany({
      select: {},
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.findMany()\` invocation in
        /client/tests/functional/query-validation/tests.ts:0:0

          XX })
          XX 
          XX test('empty selection', async () => {
        → XX   const result = prisma.user.findMany({
                  select: {
                ?   id?: true,
                ?   email?: true,
                ?   name?: true,
                ?   createdAt?: true,
                ?   published?: true,
                ?   organizationId?: true,
                ?   organization?: true
                  }
                })

        The \`select\` statement for type User must not be empty. Available options are marked with ?."
      `)
  })

  test('unknown argument', async () => {
    const result = prisma.user.findMany({
      // @ts-expect-error
      notAnArgument: 123,
    })

    if (
      cliMeta.previewFeatures.includes('relationJoins') &&
      providersSupportingRelationJoins.includes(suiteConfig.provider)
    ) {
      await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.findMany()\` invocation in
          /client/tests/functional/query-validation/tests.ts:0:0

            XX })
            XX 
            XX test('unknown argument', async () => {
          → XX   const result = prisma.user.findMany({
                    notAnArgument: 123,
                    ~~~~~~~~~~~~~
                  ? where?: UserWhereInput,
                  ? orderBy?: UserOrderByWithRelationInput[] | UserOrderByWithRelationInput,
                  ? cursor?: UserWhereUniqueInput,
                  ? take?: Int,
                  ? skip?: Int,
                  ? distinct?: UserScalarFieldEnum | UserScalarFieldEnum[],
                  ? relationLoadStrategy?: RelationLoadStrategy
                  })

          Unknown argument \`notAnArgument\`. Available options are marked with ?."
        `)
    } else {
      await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.findMany()\` invocation in
          /client/tests/functional/query-validation/tests.ts:0:0

            XX })
            XX 
            XX test('unknown argument', async () => {
          → XX   const result = prisma.user.findMany({
                    notAnArgument: 123,
                    ~~~~~~~~~~~~~
                  ? where?: UserWhereInput,
                  ? orderBy?: UserOrderByWithRelationInput[] | UserOrderByWithRelationInput,
                  ? cursor?: UserWhereUniqueInput,
                  ? take?: Int,
                  ? skip?: Int,
                  ? distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
                  })

          Unknown argument \`notAnArgument\`. Available options are marked with ?."
        `)
    }
  })

  test('unknown object field', async () => {
    const result = prisma.user.findMany({
      where: {
        // @ts-expect-error
        notAValidField: 123,
      },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.findMany()\` invocation in
        /client/tests/functional/query-validation/tests.ts:0:0

          XX })
          XX 
          XX test('unknown object field', async () => {
        → XX   const result = prisma.user.findMany({
                  where: {
                    notAValidField: 123,
                    ~~~~~~~~~~~~~~
                ?   AND?: UserWhereInput | UserWhereInput[],
                ?   OR?: UserWhereInput[],
                ?   NOT?: UserWhereInput | UserWhereInput[],
                ?   id?: StringFilter | String,
                ?   email?: StringFilter | String,
                ?   name?: StringFilter | String,
                ?   createdAt?: DateTimeFilter | DateTime,
                ?   published?: BoolFilter | Boolean,
                ?   organizationId?: StringFilter | String,
                ?   organization?: OrganizationScalarRelationFilter | OrganizationWhereInput
                  }
                })

        Unknown argument \`notAValidField\`. Available options are marked with ?."
      `)
  })

  test('missing required argument: nested', async () => {
    // @ts-expect-error
    const result = prisma.user.create({ data: {} })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.create()\` invocation in
        /client/tests/functional/query-validation/tests.ts:0:0

          XX 
          XX test('missing required argument: nested', async () => {
          XX   // @ts-expect-error
        → XX   const result = prisma.user.create({
                  data: {
                +   email: String
                  }
                })

        Argument \`email\` is missing."
      `)
  })

  test('invalid argument type', async () => {
    const result = prisma.user.findUnique({
      where: {
        // @ts-expect-error
        email: 123,
      },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.findUnique()\` invocation in
        /client/tests/functional/query-validation/tests.ts:0:0

          XX })
          XX 
          XX test('invalid argument type', async () => {
        → XX   const result = prisma.user.findUnique({
                  where: {
                    email: 123
                           ~~~
                  }
                })

        Argument \`email\`: Invalid value provided. Expected String, provided Int."
      `)
  })

  test('invalid field ref', async () => {
    const result = prisma.user.findFirst({
      where: {
        // @ts-expect-error
        name: { gt: prisma.pet.fields.name },
      },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.findFirst()\` invocation in
        /client/tests/functional/query-validation/tests.ts:0:0

          XX })
          XX 
          XX test('invalid field ref', async () => {
        → XX   const result = prisma.user.findFirst(
        Input error. Expected a referenced scalar field of model User, but found a field of model Pet."
      `)
  })

  test('union error', async () => {
    const result = prisma.user.findMany({
      where: {
        // @ts-expect-error
        email: 123,
      },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.findMany()\` invocation in
        /client/tests/functional/query-validation/tests.ts:0:0

          XX })
          XX 
          XX test('union error', async () => {
        → XX   const result = prisma.user.findMany({
                  where: {
                    email: 123
                           ~~~
                  }
                })

        Argument \`email\`: Invalid value provided. Expected StringFilter or String, provided Int."
      `)
  })

  test('union error: different paths', async () => {
    const result = prisma.user.findMany({
      where: {
        // @ts-expect-error
        email: { gt: 123 },
      },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.findMany()\` invocation in
        /client/tests/functional/query-validation/tests.ts:0:0

          XX })
          XX 
          XX test('union error: different paths', async () => {
        → XX   const result = prisma.user.findMany({
                  where: {
                    email: {
                      gt: 123
                          ~~~
                    }
                  }
                })

        Argument \`gt\`: Invalid value provided. Expected String or StringFieldRefInput, provided Int."
      `)
  })

  // https://github.com/prisma/prisma/issues/19707
  test('union error: invalid argument type vs required argument missing', async () => {
    const result = prisma.user.create({
      data: {
        name: 'Horsey McHorseface',
        // @ts-expect-error
        email: 123,
        organizationId: 'a123456789012456789',
      },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.create()\` invocation in
        /client/tests/functional/query-validation/tests.ts:0:0

          XX 
          XX // https://github.com/prisma/prisma/issues/19707
          XX test('union error: invalid argument type vs required argument missing', async () => {
        → XX   const result = prisma.user.create({
                  data: {
                    name: "Horsey McHorseface",
                    email: 123,
                           ~~~
                    organizationId: "a123456789012456789"
                  }
                })

        Argument \`email\`: Invalid value provided. Expected String, provided Int."
      `)
  })

  test('invalid argument value', async () => {
    const result = prisma.user.findMany({
      where: {
        createdAt: { gt: 'yesterday' },
      },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.findMany()\` invocation in
        /client/tests/functional/query-validation/tests.ts:0:0

          XX })
          XX 
          XX test('invalid argument value', async () => {
        → XX   const result = prisma.user.findMany({
                  where: {
                    createdAt: {
                      gt: "yesterday"
                          ~~~~~~~~~~~
                    }
                  }
                })

        Invalid value for argument \`gt\`: input contains invalid characters. Expected ISO-8601 DateTime."
      `)
  })

  test('missing one of the specific required fields', async () => {
    const result = prisma.user.findUnique({
      // @ts-expect-error
      where: {},
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.findUnique()\` invocation in
        /client/tests/functional/query-validation/tests.ts:0:0

          XX })
          XX 
          XX test('missing one of the specific required fields', async () => {
        → XX   const result = prisma.user.findUnique({
                  where: {
                ?   id?: String,
                ?   email?: String,
                ?   organizationId?: String,
                ?   AND?: UserWhereInput | UserWhereInput[],
                ?   OR?: UserWhereInput[],
                ?   NOT?: UserWhereInput | UserWhereInput[],
                ?   name?: StringFilter | String,
                ?   createdAt?: DateTimeFilter | DateTime,
                ?   published?: BoolFilter | Boolean,
                ?   organization?: OrganizationScalarRelationFilter | OrganizationWhereInput
                  }
                })

        Argument \`where\` of type UserWhereUniqueInput needs at least one of \`id\`, \`email\` or \`organizationId\` arguments. Available options are marked with ?."
      `)
  })

  test('non-serializable value', async () => {
    const result = prisma.user.findMany({
      where: {
        // @ts-expect-error
        name: () => 'foo',
      },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.findMany()\` invocation in
        /client/tests/functional/query-validation/tests.ts:0:0

          XX })
          XX 
          XX test('non-serializable value', async () => {
        → XX   const result = prisma.user.findMany({
                  where: {
                    name: [object Function]
                          ~~~~~~~~~~~~~~~~~
                  }
                })

        Invalid value for argument \`name\`: We could not serialize [object Function] value. Serialize the object to JSON or implement a ".toJSON()" method on it."
      `)
  })
})
