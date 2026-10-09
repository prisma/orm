import { Prisma, PrismaClient } from './generated/prisma/client'

const prisma = new PrismaClient({ adapter: {} as never }).$extends({
  model: {
    employeeBenefit: {
      findManyAllVersions(args?: Prisma.EmployeeBenefitFindManyArgs) {
        /* eslint-disable @typescript-eslint/no-redundant-type-constituents -- generated Prisma types are unavailable before `prisma generate` runs in this fixture. */
        const normalizedArgs = {
          ...(args || {}),
        } as Prisma.EmployeeBenefitFindManyArgs & {
          allVersions?: boolean
        }
        /* eslint-enable @typescript-eslint/no-redundant-type-constituents */

        normalizedArgs.allVersions = true

        const context = Prisma.getExtensionContext(this)

        // in Prisma 7.x this test failed with the error "TS2321: Excessive stack depth comparing types 'EmployeeBenefitSelect<DefaultArgs>' and 'EmployeeBenefitSelect<InternalArgs & DefaultArgs>'."
        return context.findMany(normalizedArgs)
      },
      foo() {
        return this
      },
    },
  },
  query: {
    employeeBenefit: {
      findMany({ args, query }) {
        /* eslint-disable @typescript-eslint/no-redundant-type-constituents -- generated Prisma types are unavailable before `prisma generate` runs in this fixture. */
        const normalizedArgs = {
          ...(args || {}),
        } as Prisma.EmployeeBenefitFindManyArgs & {
          allVersions?: boolean
        }
        /* eslint-enable @typescript-eslint/no-redundant-type-constituents */

        if (normalizedArgs.allVersions !== true) {
          normalizedArgs.where = {
            AND: [normalizedArgs.where || {}, { currentVersion: true }],
          }
        }

        if ('allVersions' in normalizedArgs) {
          delete normalizedArgs.allVersions
        }

        return query(normalizedArgs)
      },
    },
  },
})

void prisma.employeeBenefit.findMany({
  where: {
    employeeId: '',
  },
})

void prisma.employeeBenefit.findManyAllVersions({
  where: {
    employeeId: '',
  },
})
