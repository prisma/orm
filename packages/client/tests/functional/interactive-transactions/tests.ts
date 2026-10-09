import { copycat } from '@snaplet/copycat'

import { AdapterProviders, Providers } from '../_utils/providers'
import { NewPrismaClient } from '../_utils/types'
import testMatrix from './_matrix'
// @ts-ignore
import type { Prisma as PrismaNamespace, PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient
declare let Prisma: typeof PrismaNamespace
declare const newPrismaClient: NewPrismaClient<PrismaClient, typeof PrismaClient>

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

testMatrix.setupTestSuite(
  ({ provider, driverAdapter }, _suiteMeta) => {
    // TODO: Technically, only "high concurrency" test requires larger timeout
    // but `jest.setTimeout` does not work inside of the test at the moment
    //  https://github.com/facebook/jest/issues/11543
    jest.setTimeout(60_000)

    beforeEach(async () => {
      await prisma.user.deleteMany()
    })

    // Regression test for https://github.com/prisma/prisma/issues/19137.
    test('issue #19137', async () => {
      expect.assertions(1)

      await prisma
        .$transaction(
          // @ts-expect-error: Type 'void' is not assignable to type 'Promise<unknown>'
          /* note how there's no `async` here */ (tx) => {
            console.log('1')
            console.log(tx)
            console.log('2')
          },
        )
        .then(() => expect(true).toBe(true))
    }, 30_000)

    /**
     * Minimal example of an interactive transaction
     */
    test('basic', async () => {
      const result = await prisma.$transaction(async (prisma) => {
        await prisma.user.create({
          data: {
            email: 'user_1@website.com',
          },
        })

        await prisma.user.create({
          data: {
            email: 'user_2@website.com',
          },
        })

        return prisma.user.findMany()
      })

      expect(result.length).toBe(2)
    })

    /**
     * Transactions should fail after the default timeout
     */
    test('timeout default', async () => {
      const result = prisma.$transaction(async (prisma) => {
        await prisma.user.create({
          data: {
            email: 'user_1@website.com',
          },
        })

        await delay(6000)
      })

      await expect(result).rejects.toMatchObject({
        message: expect.stringMatching(
          /A commit cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however \d+ ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction./,
        ),
        code: 'P2028',
        clientVersion: '0.0.0',
      })

      expect(await prisma.user.findMany()).toHaveLength(0)
    })

    /**
     * Transactions should fail if they time out on `timeout`
     */
    test('timeout override', async () => {
      const result = prisma.$transaction(
        async (prisma) => {
          await prisma.user.create({
            data: {
              email: 'user_1@website.com',
            },
          })

          await delay(600)
        },
        {
          maxWait: 200,
          timeout: 500,
        },
      )

      await expect(result).rejects.toMatchObject({
        message: expect.stringMatching(
          /A commit cannot be executed on an expired transaction. The timeout for this transaction was 500 ms, however \d+ ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction./,
        ),
      })

      expect(await prisma.user.findMany()).toHaveLength(0)
    })

    /**
     * Transactions should fail if they time out on `timeout` by PrismaClient
     */
    test('timeout override by PrismaClient', async () => {
      const isolatedPrisma = newPrismaClient({
        transactionOptions: {
          maxWait: 200,
          timeout: 500,
        },
      })
      const result = isolatedPrisma.$transaction(async (prisma) => {
        await prisma.user.create({
          data: {
            email: 'user_1@website.com',
          },
        })

        await delay(600)
      })

      if (driverAdapter === AdapterProviders.JS_NEON) {
        // Neon sometimes raises 'Unable to start a transaction in the given time.'
        await expect(result).rejects.toMatchObject({
          message: expect.stringMatching(/Transaction API error/),
        })
      } else {
        await expect(result).rejects.toMatchObject({
          message: expect.stringMatching(
            /A commit cannot be executed on an expired transaction. The timeout for this transaction was 500 ms, however \d+ ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction./,
          ),
        })
      }

      expect(await prisma.user.findMany()).toHaveLength(0)
    })

    /**
     * Transactions should fail and rollback if thrown within
     */
    test('rollback throw', async () => {
      const result = prisma.$transaction(async (prisma) => {
        await prisma.user.create({
          data: {
            email: 'user_1@website.com',
          },
        })

        throw new Error('you better rollback now')
      })

      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`"you better rollback now"`)

      const users = await prisma.user.findMany()

      expect(users.length).toBe(0)
    })

    /**
     * Transactions should fail and rollback if a value is thrown within
     */
    test('rollback throw value', async () => {
      const result = prisma.$transaction(async (prisma) => {
        await prisma.user.create({
          data: {
            email: 'user_1@website.com',
          },
        })

        throw 'you better rollback now'
      })

      await expect(result).rejects.toBe(`you better rollback now`)

      const users = await prisma.user.findMany()

      expect(users.length).toBe(0)
    })

    /**
     * A transaction might fail if it's called inside another transaction
     * //! this works only for postgresql
     */
    testIf(provider === Providers.POSTGRESQL)('postgresql: nested create', async () => {
      const result = prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            email: 'user_1@website.com',
          },
        })

        await prisma.$transaction(async (tx) => {
          await tx.user.create({
            data: {
              email: 'user_2@website.com',
            },
          })
        })

        return tx.user.findMany()
      })

      await expect(result).resolves.toHaveLength(2)
    })

    testIf(provider === Providers.MONGODB)('mongodb: nested transactions are not available in types', async () => {
      await prisma.$transaction((tx) => {
        // For MongoDB, the transaction-bound client type should not expose `$transaction`.
        // We keep this as a type-only assertion: at runtime, this is just a property access.
        // @ts-test-if: provider !== Providers.MONGODB
        void tx.$transaction
        return Promise.resolve()
      })
    })

    /**
     * If a parent transaction is rolled back, the child transaction should also rollback.
     * This is only supported on SQL providers.
     */
    testIf(provider !== Providers.MONGODB)('sql: nested rollback', async () => {
      const email1 = `user_${copycat.uuid(101)}@website.com`
      const email2 = `user_${copycat.uuid(102)}@website.com`

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.user.create({
            data: {
              email: email1,
            },
          })

          await tx.$transaction(async (tx2) => {
            await tx2.user.create({
              data: {
                email: email2,
              },
            })
          })

          throw new Error('Rollback')
        }),
      ).rejects.toThrow(/Rollback/)

      const users = await prisma.user.findMany({
        where: {
          email: {
            in: [email1, email2],
          },
        },
      })

      expect(users).toHaveLength(0)
    })

    testIf(provider !== Providers.MONGODB)(
      'sql: nested rollback restores parent state (savepoints, 3 levels)',
      async () => {
        const emailA = `user_${copycat.uuid(151)}@website.com`
        const emailB = `user_${copycat.uuid(152)}@website.com`
        const emailC = `user_${copycat.uuid(153)}@website.com`

        const outerPromise = prisma.$transaction(async (tx) => {
          await tx.user.create({ data: { email: emailA } })

          const afterOuterInsert = await tx.user.findMany({ where: { email: { in: [emailA, emailB, emailC] } } })
          expect(afterOuterInsert).toHaveLength(1)

          try {
            await tx.$transaction(async (tx2) => {
              await tx2.user.create({ data: { email: emailB } })

              const afterInnerInsert = await tx2.user.findMany({ where: { email: { in: [emailA, emailB, emailC] } } })
              expect(afterInnerInsert).toHaveLength(2)

              try {
                await tx2.$transaction(async (tx3) => {
                  await tx3.user.create({ data: { email: emailC } })
                  const afterGrandchildInsert = await tx3.user.findMany({
                    where: { email: { in: [emailA, emailB, emailC] } },
                  })
                  expect(afterGrandchildInsert).toHaveLength(3)
                  throw new Error('grandchild rollback')
                })
              } catch (e) {
                expect(e).toMatchObject({ message: 'grandchild rollback' })
              }

              const afterGrandchildRollback = await tx2.user.findMany({
                where: { email: { in: [emailA, emailB, emailC] } },
              })
              expect(afterGrandchildRollback).toHaveLength(2)

              throw new Error('child rollback')
            })
          } catch (e) {
            expect(e).toMatchObject({ message: 'child rollback' })
          }

          const afterChildRollback = await tx.user.findMany({ where: { email: { in: [emailA, emailB, emailC] } } })
          expect(afterChildRollback).toHaveLength(1)

          throw new Error('outer rollback')
        })

        await expect(outerPromise).rejects.toThrow('outer rollback')

        const users = await prisma.user.findMany({ where: { email: { in: [emailA, emailB, emailC] } } })
        expect(users).toHaveLength(0)
      },
    )

    testIf(provider !== Providers.MONGODB)('sql: nested commit keeps state (savepoints, 3 levels)', async () => {
      const emailA = `user_${copycat.uuid(161)}@website.com`
      const emailB = `user_${copycat.uuid(162)}@website.com`
      const emailC = `user_${copycat.uuid(163)}@website.com`

      await prisma.$transaction(async (tx) => {
        await tx.user.create({ data: { email: emailA } })

        await tx.$transaction(async (tx2) => {
          await tx2.user.create({ data: { email: emailB } })

          await tx2.$transaction(async (tx3) => {
            await tx3.user.create({ data: { email: emailC } })

            const inside = await tx3.user.findMany({ where: { email: { in: [emailA, emailB, emailC] } } })
            expect(inside).toHaveLength(3)
          })
        })

        const insideOuter = await tx.user.findMany({ where: { email: { in: [emailA, emailB, emailC] } } })
        expect(insideOuter).toHaveLength(3)
      })

      const users = await prisma.user.findMany({
        where: { email: { in: [emailA, emailB, emailC] } },
        orderBy: { email: 'asc' },
      })
      expect(users).toHaveLength(3)
    })

    testIf(provider !== Providers.MONGODB)('sql: disallow concurrent nested transactions', async () => {
      const result = prisma.$transaction(async (tx) => {
        const email1 = `user_${copycat.uuid(201)}@website.com`
        const email2 = `user_${copycat.uuid(202)}@website.com`
        const email3 = `user_${copycat.uuid(203)}@website.com`
        const email4 = `user_${copycat.uuid(204)}@website.com`
        const email5 = `user_${copycat.uuid(205)}@website.com`
        const email6 = `user_${copycat.uuid(206)}@website.com`
        const email7 = `user_${copycat.uuid(207)}@website.com`

        await Promise.all([
          tx.$transaction(async (tx2) => {
            await tx2.user.create({ data: { email: email1 } })
            await tx2.user.create({ data: { email: email2 } })
            await tx2.user.create({ data: { email: email3 } })
          }),
          tx.$transaction(async (tx3) => {
            await tx3.user.create({ data: { email: email4 } })
            await tx3.user.create({ data: { email: email5 } })
          }),
          tx.$transaction(async (tx4) => {
            await tx4.user.create({ data: { email: email6 } })
            await tx4.user.create({ data: { email: email7 } })
          }),
        ])
      })

      await expect(result).rejects.toThrow('Concurrent nested transactions are not supported')

      // No partial writes should be visible after the outer transaction fails.
      const users = await prisma.user.findMany()
      expect(users).toHaveLength(0)
    })

    testIf(provider !== Providers.MONGODB)(
      'sql: allow nested transactions in concurrent top-level transactions',
      async () => {
        const a1 = `user_${copycat.uuid(401)}@website.com`
        const a2 = `user_${copycat.uuid(402)}@website.com`
        const b1 = `user_${copycat.uuid(403)}@website.com`
        const b2 = `user_${copycat.uuid(404)}@website.com`

        await Promise.all([
          prisma.$transaction(async (tx) => {
            await tx.user.create({ data: { email: a1 } })
            await delay(25)
            await tx.$transaction(async (tx2) => {
              await delay(25)
              await tx2.user.create({ data: { email: a2 } })
            })
          }),
          prisma.$transaction(async (tx) => {
            await tx.user.create({ data: { email: b1 } })
            await delay(25)
            await tx.$transaction(async (tx2) => {
              await delay(25)
              await tx2.user.create({ data: { email: b2 } })
            })
          }),
        ])

        const users = await prisma.user.findMany({ where: { email: { in: [a1, a2, b1, b2] } } })
        expect(users).toHaveLength(4)
      },
    )

    testIf(provider !== Providers.MONGODB)('sql: nested commit keeps outer transaction open', async () => {
      const email1 = `user_${copycat.uuid(211)}@website.com`
      const email2 = `user_${copycat.uuid(212)}@website.com`
      const email3 = `user_${copycat.uuid(213)}@website.com`

      const users = await prisma.$transaction(async (tx) => {
        await tx.user.create({ data: { email: email1 } })

        await tx.$transaction(async (tx2) => {
          await tx2.user.create({ data: { email: email2 } })
        })

        // If nested commit incorrectly closes the underlying transaction,
        // this query or the final commit will fail.
        await tx.user.create({ data: { email: email3 } })

        return tx.user.findMany({
          where: { email: { in: [email1, email2, email3] } },
          orderBy: { email: 'asc' },
        })
      })

      expect(users).toHaveLength(3)
    })

    testIf(provider !== Providers.MONGODB)('sql: sequential nested transactions work', async () => {
      const email1 = `user_${copycat.uuid(221)}@website.com`
      const email2 = `user_${copycat.uuid(222)}@website.com`
      const email3 = `user_${copycat.uuid(223)}@website.com`

      await prisma.$transaction(async (tx) => {
        await tx.$transaction(async (tx2) => {
          await tx2.user.create({ data: { email: email1 } })
        })

        await tx.$transaction(async (tx3) => {
          await tx3.user.create({ data: { email: email2 } })
        })

        await tx.user.create({ data: { email: email3 } })
      })

      const users = await prisma.user.findMany({
        where: { email: { in: [email1, email2, email3] } },
      })
      expect(users).toHaveLength(3)
    })

    testIf(provider !== Providers.MONGODB)('sql: deep nesting (3 levels) works', async () => {
      const email1 = `user_${copycat.uuid(231)}@website.com`
      const email2 = `user_${copycat.uuid(232)}@website.com`
      const email3 = `user_${copycat.uuid(233)}@website.com`

      await prisma.$transaction(async (tx) => {
        await tx.user.create({ data: { email: email1 } })

        await tx.$transaction(async (tx2) => {
          await tx2.user.create({ data: { email: email2 } })

          await tx2.$transaction(async (tx3) => {
            await tx3.user.create({ data: { email: email3 } })
          })
        })
      })

      const users = await prisma.user.findMany({
        where: { email: { in: [email1, email2, email3] } },
      })
      expect(users).toHaveLength(3)
    })

    testIf(provider !== Providers.MONGODB)('sql: nested rollback can be caught and outer can continue', async () => {
      const outerEmail1 = `user_${copycat.uuid(241)}@website.com`
      const innerEmail = `user_${copycat.uuid(242)}@website.com`
      const outerEmail2 = `user_${copycat.uuid(243)}@website.com`

      await prisma.$transaction(async (tx) => {
        await tx.user.create({ data: { email: outerEmail1 } })

        try {
          await tx.$transaction(async (tx2) => {
            await tx2.user.create({ data: { email: innerEmail } })
            throw new Error('inner rollback')
          })
        } catch (e) {
          expect(e).toMatchObject({ message: 'inner rollback' })
        }

        await tx.user.create({ data: { email: outerEmail2 } })
      })

      const users = await prisma.user.findMany({
        where: { email: { in: [outerEmail1, innerEmail, outerEmail2] } },
        orderBy: { email: 'asc' },
      })

      expect(users.map((u) => u.email)).toEqual([outerEmail1, outerEmail2].sort())
    })

    testIf(provider !== Providers.MONGODB)('sql: nested transaction does not mutate the options object', async () => {
      const email1 = `user_${copycat.uuid(251)}@website.com`
      const email2 = `user_${copycat.uuid(252)}@website.com`
      const options = { maxWait: 5000, timeout: 5000 }

      await prisma.$transaction(async (tx) => {
        await tx.$transaction(async (tx2) => {
          await tx2.user.create({ data: { email: email1 } })
        }, options)
      }, options)

      expect(options).toStrictEqual({ maxWait: 5000, timeout: 5000 })

      await prisma.$transaction(async (tx) => {
        await tx.user.create({ data: { email: email2 } })
      }, options)

      const users = await prisma.user.findMany({
        where: { email: { in: [email1, email2] } },
      })
      expect(users).toHaveLength(2)
    })

    testIf(provider !== Providers.MONGODB)('sql: enforce order for nested transactions', async () => {
      const result = prisma.$transaction(async (tx) => {
        const nested = tx.$transaction(async (tx2) => {
          await tx2.user.create({ data: { email: `user_${copycat.uuid(301)}@website.com` } })
          await delay(50)
        })
        nested.catch(() => {}) // avoid unhandled rejection in this test

        await tx.user.create({ data: { email: `user_${copycat.uuid(302)}@website.com` } })
      })

      await expect(result).rejects.toThrow('Cannot close transaction while a nested transaction is still active.')

      const users = await prisma.user.findMany()
      expect(users).toHaveLength(0)
    })

    testIf(provider !== Providers.MONGODB)(
      'sql: child fails if parent tries to commit before child finishes',
      async () => {
        const email = `user_${copycat.uuid(521)}@website.com`
        let child: Promise<unknown> | undefined

        const parent = prisma.$transaction((tx) => {
          child = tx.$transaction(async (tx2) => {
            await delay(50)
            await tx2.user.create({ data: { email } })
          })
          child.catch(() => {}) // prevent unhandled rejection if parent fails fast

          // Parent returns immediately (commit attempt) without awaiting the child.
          return Promise.resolve()
        })

        await expect(parent).rejects.toThrow('Cannot close transaction while a nested transaction is still active.')
        await expect(child).rejects.toMatchObject({
          code: 'P2028',
        })

        const users = await prisma.user.findMany({ where: { email } })
        expect(users).toHaveLength(0)
      },
    )

    testIf(provider !== Providers.MONGODB)('sql: child fails if parent rolls back before child finishes', async () => {
      const email = `user_${copycat.uuid(501)}@website.com`
      let child: Promise<unknown> | undefined

      const parent = prisma.$transaction((tx) => {
        child = tx.$transaction(async (tx2) => {
          await delay(50)
          await tx2.user.create({ data: { email } })
        })
        child.catch(() => {}) // prevent unhandled rejection if parent fails fast

        return Promise.reject(new Error('parent rollback'))
      })

      await expect(parent).rejects.toThrow('parent rollback')
      await expect(child).rejects.toMatchObject({
        code: 'P2028',
      })

      const users = await prisma.user.findMany({ where: { email } })
      expect(users).toHaveLength(0)
    })

    testIf(provider !== Providers.MONGODB)(
      'sql: child fails if nested parent closes before grandchild finishes',
      async () => {
        const email = `user_${copycat.uuid(511)}@website.com`
        let grandchild: Promise<unknown> | undefined

        const parent = prisma.$transaction(async (tx) => {
          await tx.$transaction((tx2) => {
            grandchild = tx2.$transaction(async (tx3) => {
              await delay(50)
              await tx3.user.create({ data: { email } })
            })
            grandchild.catch(() => {}) // prevent unhandled rejection if parent fails fast

            // Intentionally don't await `grandchild` to simulate incorrect ordering.
            // The parent nested transaction should fail to close and the whole top-level tx should rollback.
            return Promise.resolve()
          })
        })

        await expect(parent).rejects.toThrow('Nested transactions must be closed in reverse order of creation.')
        await expect(grandchild).rejects.toMatchObject({
          code: 'P2028',
        })

        const users = await prisma.user.findMany({ where: { email } })
        expect(users).toHaveLength(0)
      },
    )

    testIf(provider === Providers.MONGODB)('mongodb: disallow nested transactions at runtime', async () => {
      const result = prisma.$transaction(async (tx) => {
        await tx.user.create({ data: { email: 'user_1@website.com' } })
        // Nested transactions are intentionally not available in types for MongoDB.
        // Bypass the type system to assert runtime behavior.
        await (tx as any).$transaction(async (tx2: any) => {
          await tx2.user.create({ data: { email: 'user_2@website.com' } })
        })
      })

      await expect(result).rejects.toThrow('The mongodb provider does not support nested transactions')
      const users = await prisma.user.findMany()
      expect(users).toHaveLength(0)
    })

    /**
     * We don't allow certain methods to be called in a transaction
     */
    test('forbidden', async () => {
      const forbidden = ['$connect', '$disconnect', '$on', '$use']
      expect.assertions(forbidden.length + 1)

      const result = prisma.$transaction((prisma) => {
        for (const method of forbidden) {
          expect(prisma).not.toHaveProperty(method)
        }
        return Promise.resolve()
      })

      await expect(result).resolves.toBe(undefined)
    })

    /**
     * If one of the query fails, all queries should cancel
     */
    test('rollback query', async () => {
      const email1 = 'user_1@website.com'
      const result = prisma.$transaction(async (prisma) => {
        await prisma.user.create({
          data: {
            id: copycat.uuid(1).replaceAll('-', '').slice(-24),
            email: email1,
          },
        })

        await prisma.user.create({
          data: {
            id: copycat.uuid(2).replaceAll('-', '').slice(-24),
            email: email1,
          },
        })
      })

      await expect(result).rejects.toMatchPrismaErrorSnapshot()

      const users = await prisma.user.findMany({
        where: {
          email: {
            equals: email1,
          },
        },
      })

      expect(users.length).toBe(0)
    })

    test('already committed', async () => {
      let transactionBoundPrisma
      await prisma.$transaction((prisma) => {
        transactionBoundPrisma = prisma
        return Promise.resolve()
      })

      const result = prisma.$transaction(async () => {
        await transactionBoundPrisma.user.create({
          data: {
            email: 'user_1@website.com',
          },
        })
      })

      await expect(result).rejects.toMatchObject({
        message: expect.stringContaining('Transaction API error: Transaction already closed'),
        code: 'P2028',
        clientVersion: '0.0.0',
      })

      await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`transactionBoundPrisma.user.create()\` invocation in
        /client/tests/functional/interactive-transactions/tests.ts:0:0

          XX })
          XX 
          XX const result = prisma.$transaction(async () => {
        → XX   await transactionBoundPrisma.user.create(
        Transaction API error: Transaction already closed: A query cannot be executed on a committed transaction."
      `)

      const users = await prisma.user.findMany()

      expect(users.length).toBe(0)
    })

    /**
     * Batching should work with using the interactive transaction logic
     */
    test('batching', async () => {
      await prisma.$transaction([
        prisma.user.create({
          data: {
            email: 'user_1@website.com',
          },
        }),
        prisma.user.create({
          data: {
            email: 'user_2@website.com',
          },
        }),
      ])

      const users = await prisma.user.findMany()

      expect(users.length).toBe(2)
    })

    /**
     * A bad batch should rollback using the interactive transaction logic
     * // TODO: skipped because output differs from binary to library
     */
    test('batching rollback', async () => {
      const result = prisma.$transaction([
        prisma.user.create({
          data: {
            id: copycat.uuid(1).replaceAll('-', '').slice(-24),
            email: 'user_1@website.com',
          },
        }),
        prisma.user.create({
          data: {
            id: copycat.uuid(2).replaceAll('-', '').slice(-24),
            email: 'user_1@website.com',
          },
        }),
      ])

      await expect(result).rejects.toMatchPrismaErrorSnapshot()

      const users = await prisma.user.findMany()

      expect(users.length).toBe(0)
    })

    test('batching rollback within callback', async () => {
      const result = prisma.$transaction(async (tx) => {
        await Promise.all([
          tx.user.create({
            data: {
              id: copycat.uuid(1).replaceAll('-', '').slice(-24),
              email: 'user_1@website.com',
            },
          }),
          tx.user.create({
            data: {
              id: copycat.uuid(2).replaceAll('-', '').slice(-24),
              email: 'user_2@website.com',
            },
          }),
        ])

        await tx.user.create({
          data: {
            id: copycat.uuid(3).replaceAll('-', '').slice(-24),
            email: 'user_1@website.com',
          },
        })
      })

      await expect(result).rejects.toMatchPrismaErrorSnapshot()

      const users = await prisma.user.findMany()

      expect(users.length).toBe(0)
    })

    test('batching timeout override', async () => {
      const isolatedPrisma = newPrismaClient({
        transactionOptions: {
          timeout: 1,
        },
      })

      await isolatedPrisma.$transaction(
        [
          isolatedPrisma.user.create({ data: { email: 'user_1@website.com' } }),
          isolatedPrisma.user.create({ data: { email: 'user_2@website.com' } }),
        ],
        { timeout: 5000 }, // fails without override
      )

      const users = await isolatedPrisma.user.findMany()
      expect(users.length).toBe(2)
    })

    /**
     * A bad batch should rollback using the interactive transaction logic
     * // TODO: skipped because output differs from binary to library
     */
    testIf(provider !== Providers.MONGODB)('batching raw rollback', async () => {
      await prisma.user.create({
        data: {
          id: '1',
          email: 'user_1@website.com',
        },
      })

      const result =
        provider === Providers.MYSQL
          ? prisma.$transaction([
              // @ts-test-if: provider !== Providers.MONGODB
              prisma.$executeRaw`INSERT INTO User (id, email) VALUES (${'2'}, ${'user_2@website.com'})`,
              // @ts-test-if: provider !== Providers.MONGODB
              prisma.$queryRaw`DELETE FROM User`,
              // @ts-test-if: provider !== Providers.MONGODB
              prisma.$executeRaw`INSERT INTO User (id, email) VALUES (${'1'}, ${'user_1@website.com'})`,
              // @ts-test-if: provider !== Providers.MONGODB
              prisma.$executeRaw`INSERT INTO User (id, email) VALUES (${'1'}, ${'user_1@website.com'})`,
            ])
          : prisma.$transaction([
              // @ts-test-if: provider !== Providers.MONGODB
              prisma.$executeRaw`INSERT INTO "User" (id, email) VALUES (${'2'}, ${'user_2@website.com'})`,
              // @ts-test-if: provider !== Providers.MONGODB
              prisma.$queryRaw`DELETE FROM "User"`,
              // @ts-test-if: provider !== Providers.MONGODB
              prisma.$executeRaw`INSERT INTO "User" (id, email) VALUES (${'1'}, ${'user_1@website.com'})`,
              // @ts-test-if: provider !== Providers.MONGODB
              prisma.$executeRaw`INSERT INTO "User" (id, email) VALUES (${'1'}, ${'user_1@website.com'})`,
            ])

      await expect(result).rejects.toMatchPrismaErrorSnapshot()

      const users = await prisma.user.findMany()

      expect(users.length).toBe(1)
    })

    /**
     * Two concurrent transactions should work
     */
    test('concurrent', async () => {
      await Promise.all([
        prisma.$transaction([
          prisma.user.create({
            data: {
              email: 'user_1@website.com',
            },
          }),
        ]),
        prisma.$transaction([
          prisma.user.create({
            data: {
              email: 'user_2@website.com',
            },
          }),
        ]),
      ])

      const users = await prisma.user.findMany()

      expect(users.length).toBe(2)
    })

    /**
     * Makes sure that the engine itself does not deadlock (regression test for https://github.com/prisma/prisma/issues/11750).
     * Issues on the database side are to be expected though: for SQLite, MySQL 8+ and MongoDB, it sometimes causes DB lock up
     * and all subsequent tests fail for some time. On SQL Server, the database kills the connections.
     */
    testIf(provider === Providers.POSTGRESQL)('high concurrency with write conflicts', async () => {
      jest.setTimeout(30_000)

      await prisma.user.create({
        data: {
          email: 'x',
          name: 'y',
        },
      })

      for (let i = 0; i < 5; i++) {
        await Promise.allSettled([
          prisma.$transaction((tx) => tx.user.update({ data: { name: 'a' }, where: { email: 'x' } }), {
            timeout: 25,
          }),
          prisma.$transaction((tx) => tx.user.update({ data: { name: 'b' }, where: { email: 'x' } }), {
            timeout: 25,
          }),
          prisma.$transaction((tx) => tx.user.update({ data: { name: 'c' }, where: { email: 'x' } }), {
            timeout: 25,
          }),
          prisma.$transaction((tx) => tx.user.update({ data: { name: 'd' }, where: { email: 'x' } }), {
            timeout: 25,
          }),
          prisma.$transaction((tx) => tx.user.update({ data: { name: 'e' }, where: { email: 'x' } }), {
            timeout: 25,
          }),
          prisma.$transaction((tx) => tx.user.update({ data: { name: 'f' }, where: { email: 'x' } }), {
            timeout: 25,
          }),
          prisma.$transaction((tx) => tx.user.update({ data: { name: 'g' }, where: { email: 'x' } }), {
            timeout: 25,
          }),
          prisma.$transaction((tx) => tx.user.update({ data: { name: 'h' }, where: { email: 'x' } }), {
            timeout: 25,
          }),
          prisma.$transaction((tx) => tx.user.update({ data: { name: 'i' }, where: { email: 'x' } }), {
            timeout: 25,
          }),
          prisma.$transaction((tx) => tx.user.update({ data: { name: 'j' }, where: { email: 'x' } }), {
            timeout: 25,
          }),
        ]).catch(() => {}) // we don't care for errors, there will be
      }
    })

    testIf(provider !== Providers.SQLITE)('high concurrency with no conflicts', async () => {
      jest.setTimeout(30_000)

      await prisma.user.create({
        data: {
          email: 'x',
          name: 'y',
        },
      })

      // None of these transactions should fail.
      for (let i = 0; i < 5; i++) {
        await Promise.allSettled([
          prisma.$transaction((tx) => tx.user.findMany()),
          prisma.$transaction((tx) => tx.user.findMany()),
          prisma.$transaction((tx) => tx.user.findMany()),
          prisma.$transaction((tx) => tx.user.findMany()),
          prisma.$transaction((tx) => tx.user.findMany()),
          prisma.$transaction((tx) => tx.user.findMany()),
          prisma.$transaction((tx) => tx.user.findMany()),
          prisma.$transaction((tx) => tx.user.findMany()),
          prisma.$transaction((tx) => tx.user.findMany()),
          prisma.$transaction((tx) => tx.user.findMany()),
        ])
      }
    })

    /**
     * Rollback should happen even with `then` calls
     */
    test('rollback with then calls', async () => {
      const result = prisma.$transaction(async (prisma) => {
        await prisma.user
          .create({
            data: {
              email: 'user_1@website.com',
            },
          })
          .then()

        await prisma.user
          .create({
            data: {
              email: 'user_2@website.com',
            },
          })
          .then()
          .then()

        throw new Error('rollback')
      })

      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`"rollback"`)

      const users = await prisma.user.findMany()

      expect(users.length).toBe(0)
    })

    /**
     * Rollback should happen even with `catch` calls
     */
    test('rollback with catch calls', async () => {
      const result = prisma.$transaction(async (prisma) => {
        await prisma.user
          .create({
            data: {
              email: 'user_1@website.com',
            },
          })
          .catch()
        await prisma.user
          .create({
            data: {
              email: 'user_2@website.com',
            },
          })
          .catch()
          .then()

        throw new Error('rollback')
      })

      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`"rollback"`)

      const users = await prisma.user.findMany()

      expect(users.length).toBe(0)
    })

    /**
     * Rollback should happen even with `finally` calls
     */
    test('rollback with finally calls', async () => {
      const result = prisma.$transaction(async (prisma) => {
        await prisma.user
          .create({
            data: {
              email: 'user_1@website.com',
            },
          })
          .finally()

        await prisma.user
          .create({
            data: {
              email: 'user_2@website.com',
            },
          })
          .then()
          .catch()
          .finally()

        throw new Error('rollback')
      })

      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`"rollback"`)

      const users = await prisma.user.findMany()

      expect(users.length).toBe(0)
    })

    /**
     * Makes sure that the engine can process when the transaction has locks inside
     * Engine PR - https://github.com/prisma/prisma-engines/pull/2811
     * Issue - https://github.com/prisma/prisma/issues/11750
     */
    testIf(provider === Providers.POSTGRESQL)('high concurrency with SET FOR UPDATE', async () => {
      jest.setTimeout(60_000)
      const CONCURRENCY = 12

      await prisma.user.create({
        data: {
          email: 'x',
          name: 'y',
          val: 1,
        },
      })

      const promises = [...Array(CONCURRENCY)].map(() =>
        prisma.$transaction(
          async (transactionPrisma) => {
            // @ts-test-if: provider !== Providers.MONGODB
            await transactionPrisma.$queryRaw`SELECT id from "User" where email = 'x' FOR UPDATE`

            const user = await transactionPrisma.user.findUniqueOrThrow({
              where: {
                email: 'x',
              },
            })

            // Add a delay here to force the transaction to be open for longer
            // this will increase the chance of deadlock in the itx transactions
            // if deadlock is a possibility.
            await delay(100)

            const updatedUser = await transactionPrisma.user.update({
              where: {
                email: 'x',
              },
              data: {
                val: user.val! + 1,
              },
            })

            return updatedUser
          },
          { timeout: 60_000, maxWait: 60_000 },
        ),
      )

      await Promise.allSettled(promises)

      const finalUser = await prisma.user.findUniqueOrThrow({
        where: {
          email: 'x',
        },
      })

      expect(finalUser.val).toEqual(CONCURRENCY + 1)
    })

    describeIf(provider !== Providers.MONGODB)('isolation levels', () => {
      function testIsolationLevel(title: string, supported: boolean, fn: () => Promise<void>) {
        test(title, async () => {
          if (supported) {
            await fn()
          } else {
            await expect(fn()).rejects.toThrow('Invalid enum value')
          }
        })
      }

      testIsolationLevel('read committed', provider !== Providers.SQLITE, async () => {
        await prisma.$transaction(
          async (tx) => {
            await tx.user.create({ data: { email: 'user@example.com' } })
          },
          {
            // @ts-test-if: !['mongodb', 'sqlite'].includes(provider)
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          },
        )
        await expect(prisma.user.findMany()).resolves.toHaveLength(1)
      })

      testIsolationLevel(
        'read uncommitted',
        provider !== Providers.SQLITE && provider !== Providers.COCKROACHDB,
        async () => {
          await prisma.$transaction(
            async (tx) => {
              await tx.user.create({ data: { email: 'user@example.com' } })
            },
            {
              // @ts-test-if: !['mongodb', 'sqlite', 'cockroachdb'].includes(provider)
              isolationLevel: Prisma.TransactionIsolationLevel.ReadUncommitted,
            },
          )
          await expect(prisma.user.findMany()).resolves.toHaveLength(1)
        },
      )

      testIsolationLevel(
        'repeatable read',
        provider !== Providers.SQLITE && provider !== Providers.COCKROACHDB,
        async () => {
          await prisma.$transaction(
            async (tx) => {
              await tx.user.create({ data: { email: 'user@example.com' } })
            },
            {
              // @ts-test-if: !['mongodb', 'sqlite', 'cockroachdb'].includes(provider)
              isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
            },
          )
          await expect(prisma.user.findMany()).resolves.toHaveLength(1)
        },
      )

      testIsolationLevel('serializable', true, async () => {
        await prisma.$transaction(
          async (tx) => {
            await tx.user.create({ data: { email: 'user@example.com' } })
          },
          {
            // @ts-test-if: provider !== Providers.MONGODB
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        )

        await expect(prisma.user.findMany()).resolves.toHaveLength(1)
      })

      // TODO: there is also Snapshot level for sqlserver
      // it needs to be explicitly enabled on DB level and test setup can't do it at the moment
      // ref: https://docs.microsoft.com/en-us/troubleshoot/sql/analysis-services/enable-snapshot-transaction-isolation-level
      // testIsolationLevel('snapshot', provider === Providers.SQLSERVER, async () => {
      //   await prisma.$transaction(
      //     async (tx) => {
      //       await tx.user.create({ data: { email: 'user@example.com' } })
      //     },
      //     {
      //       // @ts-test-if: provider === Providers.SQLSERVER
      //       isolationLevel: Prisma.TransactionIsolationLevel.Snapshot,
      //     },
      //   )

      //   await expect(prisma.user.findMany()).resolves.toHaveLength(1)
      // })

      test('invalid value', async () => {
        // @ts-test-if: provider === Providers.MONGODB
        const result = prisma.$transaction(
          async (tx) => {
            await tx.user.create({ data: { email: 'user@example.com' } })
          },
          {
            // @ts-test-if: provider !== Providers.MONGODB
            isolationLevel: 'NotAValidLevel',
          },
        )

        await expect(result).rejects.toMatchObject({
          code: 'P2023',
          clientVersion: '0.0.0',
        })

        await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
          `"Inconsistent column data: Conversion failed: Invalid isolation level \`NotAValidLevel\`"`,
        )
      })
    })

    testIf(provider === Providers.MONGODB)('attempt to set isolation level on mongo', async () => {
      // @ts-test-if: provider === Providers.MONGODB
      const result = prisma.$transaction(
        async (tx) => {
          await tx.user.create({ data: { email: 'user@example.com' } })
        },
        {
          // @ts-test-if: provider !== Providers.MONGODB
          isolationLevel: 'CanBeAnything',
        },
      )

      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
        `"The current database provider doesn't support a feature that the query used: Mongo does not support setting transaction isolation levels."`,
      )
    })
  },
  {
    skipDriverAdapter: {
      from: [AdapterProviders.JS_D1, AdapterProviders.JS_LIBSQL],
      reason:
        'js_d1: iTx are not possible. There is no Transaction API for D1 yet: https://github.com/cloudflare/workers-sdk/issues/2733; ' +
        'js_libsql: SIGABRT crash occurs on having the first transaction with at least two create statements, panic inside `statement.rs` inside libsql',
    },
  },
)
