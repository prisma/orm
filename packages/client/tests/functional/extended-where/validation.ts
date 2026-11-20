import { expectTypeOf } from 'expect-type'

import testMatrix from './_matrix'
// @ts-ignore
import type { Prisma as PrismaNamespace, PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

// arbitrarily chose delete operation to test errors for invalid inputs
testMatrix.setupTestSuite((_0, _1) => {
  test('where and no keys provided', async () => {
    const result = prisma.user.delete({
      // @ts-expect-error
      where: {},
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
      "
      Invalid \`prisma.user.delete()\` invocation in
      /client/tests/functional/extended-where/validation.ts:0:0

         XX // arbitrarily chose delete operation to test errors for invalid inputs
        XX testMatrix.setupTestSuite((_0, _1) => {
        XX   test('where and no keys provided', async () => {
      → XX     const result = prisma.user.delete({
                 where: {
               ?   id?: String,
               ?   referralId?: String,
               ?   paymentId?: String,
               ?   AND?: UserWhereInput | UserWhereInput[],
               ?   OR?: UserWhereInput[],
               ?   NOT?: UserWhereInput | UserWhereInput[],
               ?   posts?: PostListRelationFilter,
               ?   profile?: ProfileNullableScalarRelationFilter | ProfileWhereInput | Null,
               ?   payment?: PaymentNullableScalarRelationFilter | PaymentWhereInput | Null
                 }
               })

      Argument \`where\` of type UserWhereUniqueInput needs at least one of \`id\`, \`referralId\` or \`paymentId\` arguments. Available options are marked with ?."
    `)
  })

  test('where and missing unique keys', async () => {
    const result = prisma.user.delete({
      // @ts-expect-error
      where: {
        profile: {},
      },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
      "
      Invalid \`prisma.user.delete()\` invocation in
      /client/tests/functional/extended-where/validation.ts:0:0

        XX })
        XX 
        XX test('where and missing unique keys', async () => {
      → XX   const result = prisma.user.delete({
               where: {
                 profile: {},
             ?   id?: String,
             ?   referralId?: String,
             ?   paymentId?: String,
             ?   AND?: UserWhereInput | UserWhereInput[],
             ?   OR?: UserWhereInput[],
             ?   NOT?: UserWhereInput | UserWhereInput[],
             ?   posts?: PostListRelationFilter,
             ?   payment?: PaymentNullableScalarRelationFilter | PaymentWhereInput | Null
               }
             })

      Argument \`where\` of type UserWhereUniqueInput needs at least one of \`id\`, \`referralId\` or \`paymentId\` arguments. Available options are marked with ?."
    `)
  })

  test('AtLeast type with optional object', () => {
    type T = PrismaNamespace.AtLeast<{ a?: string; b?: string; c?: string }, 'a'>

    expectTypeOf<T>().toHaveProperty('a').toMatchTypeOf<string | undefined>()
    expectTypeOf<T>().toHaveProperty('b').toMatchTypeOf<string | undefined>()
    expectTypeOf<T>().toHaveProperty('c').toMatchTypeOf<string | undefined>()
    expectTypeOf<{ a: string | undefined; b?: string; c?: string }>().toMatchTypeOf<T>()
    expectTypeOf<{ a: string; b?: string; c?: string }>().toMatchTypeOf<T>()
    expectTypeOf<T>().toMatchTypeOf<
      { a: string; b?: string; c?: string } | { a: string | undefined; b?: string; c?: string }
    >()
  })

  test('AtLeast type with optional object and no keys', () => {
    type T = PrismaNamespace.AtLeast<{ a?: string; b?: string; c?: string }, never>

    expectTypeOf<T>().toHaveProperty('a').toMatchTypeOf<string | undefined>()
    expectTypeOf<T>().toHaveProperty('b').toMatchTypeOf<string | undefined>()
    expectTypeOf<T>().toHaveProperty('c').toMatchTypeOf<string | undefined>()
    expectTypeOf<T>().toMatchTypeOf<{ a?: string; b?: string; c?: string }>()
  })
})
