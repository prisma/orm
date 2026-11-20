import * as ts from '@prisma/ts-builders'

import { commonCodeTS } from '../common'
import { Enum } from '../Enum'
import { FieldRefInput } from '../FieldRefInput'
import { GenerateContext } from '../GenerateContext'
import { globalOmitConfig } from '../globalOmit'
import type { TSClientOptions } from '../TSClient'
import { clientTypeMapDefinition } from '../TypeMap'

const jsDocHeader = `/*
 * WARNING: This is an internal file that is subject to change!
 *
 * 🛑 Under no circumstances should you import this file directly! 🛑
 *
 * All exports from this file are wrapped under a \`Prisma\` namespace object in the client.ts file.
 * While this enables partial backward compatibility, it is not part of the stable public API.
 *
 * If you are looking for your Models, Enums, and Input Types, please import them from the respective
 * model files in the \`model\` directory!
 */
`
export function createPrismaNamespaceFile(context: GenerateContext, options: TSClientOptions): string {
  const imports = [
    ts.moduleImport(context.runtimeImport).asNamespace('runtime'),
    ts.moduleImport(context.importFileName(`../models`)).asNamespace('Prisma').typeOnly(),
    ts.moduleImport(context.importFileName(`./class`)).named(ts.namedImport('PrismaClient').typeOnly()),
  ].map((i) => ts.stringify(i))

  const prismaEnums = context.dmmf.schema.enumTypes.prisma?.map((type) => new Enum(type, true).toTS())

  const fieldRefs = context.dmmf.schema.fieldRefTypes.prisma?.map((type) => new FieldRefInput(type).toTS()) ?? []

  const transactionClientDenyList = context.isSqlProvider()
    ? 'runtime.ITXClientDenyList'
    : "runtime.ITXClientDenyList | '$transaction'"

  return `${jsDocHeader}
${imports.join('\n')}

export type * from '${context.importFileName(`../models`)}'

${commonCodeTS(options)}
${new Enum(
  {
    name: 'ModelName',
    values: context.dmmf.mappings.modelOperations.map((m) => m.model),
  },
  true,
).toTS()}

${clientTypeMapDefinition(context)}

/**
 * Enums
 */

${prismaEnums?.join('\n\n')}

${
  fieldRefs.length > 0
    ? `
/**
 * Field references
 */

${fieldRefs.join('\n\n')}`
    : ''
}

/**
 * Batch Payload for updateMany & deleteMany & createMany
 */
export type BatchPayload = {
  count: number
}

${clientExtensionsDefinitions()}
export type DefaultPrismaClient = PrismaClient
export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
${buildClientOptions(context)}
${ts.stringify(globalOmitConfig(context.dmmf))}

/* Types for Logging */
export type LogLevel = 'info' | 'query' | 'warn' | 'error'
export type LogDefinition = {
  level: LogLevel
  emit: 'stdout' | 'event'
}

export type CheckIsLogLevel<T> = T extends LogLevel ? T : never;

export type GetLogType<T> = CheckIsLogLevel<
  T extends LogDefinition ? T['level'] : T
>;

export type GetEvents<T extends any[]> = T extends Array<LogLevel | LogDefinition>
  ? GetLogType<T[number]>
  : never;

export type QueryEvent = {
  timestamp: Date
  query: string
  params: string
  duration: number
  target: string
}

export type LogEvent = {
  timestamp: Date
  message: string
  target: string
}
/* End Types for Logging */


export type PrismaAction =
  | 'findUnique'
  | 'findUniqueOrThrow'
  | 'findMany'
  | 'findFirst'
  | 'findFirstOrThrow'
  | 'create'
  | 'createMany'
  | 'createManyAndReturn'
  | 'update'
  | 'updateMany'
  | 'updateManyAndReturn'
  | 'upsert'
  | 'delete'
  | 'deleteMany'
  | 'executeRaw'
  | 'queryRaw'
  | 'aggregate'
  | 'count'
  | 'runCommandRaw'
  | 'findRaw'
  | 'groupBy'

/**
 * \`PrismaClient\` proxy available in interactive transactions.
 */
export type TransactionClient = Omit<DefaultPrismaClient, ${transactionClientDenyList}>

`
}

function clientExtensionsDefinitions() {
  const define = ts.moduleExport(
    ts.constDeclaration('defineExtension').setValue(
      ts
        .namedValue('runtime.Extensions.defineExtension')
        .as(ts.namedType('unknown'))
        .as(
          ts
            .namedType('runtime.Types.Extensions.ExtendsHook')
            .addGenericArgument(ts.stringLiteral('define'))
            .addGenericArgument(ts.namedType('TypeMapCb'))
            .addGenericArgument(ts.namedType('runtime.Types.Extensions.DefaultArgs')),
        ),
    ),
  )

  return ts.stringify(define)
}

function buildClientOptions(context: GenerateContext) {
  // Build the shared base options interface.
  // Matches `PrismaClientBaseOptions` in the runtime.
  const baseOptions = ts
    .interfaceDeclaration('PrismaClientBaseOptions')
    .add(
      ts
        .property('errorFormat', ts.namedType('ErrorFormat'))
        .optional()
        .setDocComment(ts.docComment('@default "colorless"')),
    )
    .add(
      ts.property('log', ts.array(ts.unionType([ts.namedType('LogLevel'), ts.namedType('LogDefinition')]))).optional()
        .setDocComment(ts.docComment`
             @example
             \`\`\`
             // Shorthand for \`emit: 'stdout'\`
             log: ['query', 'info', 'warn', 'error']

             // Emit as events only
             log: [
               { emit: 'event', level: 'query' },
               { emit: 'event', level: 'info' },
               { emit: 'event', level: 'warn' }
               { emit: 'event', level: 'error' }
             ]

            // Emit as events and log to stdout
            log: [
              { emit: 'stdout', level: 'query' },
              { emit: 'stdout', level: 'info' },
              { emit: 'stdout', level: 'warn' }
              { emit: 'stdout', level: 'error' }
            ]
             \`\`\`
             Read more in our [docs](https://pris.ly/d/logging).
          `),
    )

  const transactionOptions = ts
    .objectType()
    .add(ts.property('maxWait', ts.numberType).optional())
    .add(ts.property('timeout', ts.numberType).optional())

  if (context.dmmf.hasEnumInNamespace('TransactionIsolationLevel', 'prisma')) {
    transactionOptions.add(ts.property('isolationLevel', ts.namedType('TransactionIsolationLevel')).optional())
  }

  baseOptions.add(
    ts.property('transactionOptions', transactionOptions).optional().setDocComment(ts.docComment`
             The default values for transactionOptions
             maxWait ?= 2000
             timeout ?= 5000
          `),
  )

  baseOptions.add(
    ts.property('omit', ts.namedType('GlobalOmitConfig')).optional().setDocComment(ts.docComment`
        Global configuration for omitting model fields by default.

        @example
        \`\`\`
        const prisma = new PrismaClient({
          omit: {
            user: {
              password: true
            }
          }
        })
        \`\`\`
      `),
  )

  if (context.isSqlProvider()) {
    baseOptions.add(
      ts.property('comments', ts.array(ts.namedType('runtime.SqlCommenterPlugin'))).optional()
        .setDocComment(ts.docComment`
        SQL commenter plugins that add metadata to SQL queries as comments.
        Comments follow the sqlcommenter format: https://google.github.io/sqlcommenter/

        @example
        \`\`\`
        const prisma = new PrismaClient({
          adapter,
          comments: [
            traceContext(),
            queryInsights(),
          ],
        })
        \`\`\`
      `),
    )
  }

  baseOptions.add(
    ts.property('queryPlanCacheMaxSize', ts.numberType).optional().setDocComment(ts.docComment`
        Optional maximum size for the query plan cache. If not provided, a default size will be used.
        A value of \`0\` can be used to disable the cache entirely. A higher cache size can improve
        performance for applications that execute a large number of unique queries, while a smaller
        cache size can reduce memory usage.

        @example
        \`\`\`
        const prisma = new PrismaClient({
          adapter,
          queryPlanCacheMaxSize: 100,
        })
        \`\`\`
      `),
  )

  // Accelerate-specific options interface that extends the base.
  // Matches `PrismaClientOptionsWithAccelerateUrl` in the runtime.
  //
  // NOTE: This is intentionally declared *before* `PrismaClientOptionsWithAdapter`,
  // and `PrismaClientOptions` (built below) lists them in the same order in its
  // union. The generator prepends `// @ts-nocheck` to all generated files by
  // default (see `tsNoCheckPreamble` in `../../generator.ts` and
  // `addPreambleToSourceFiles` in `../../utils/addPreamble.ts`), and with
  // `// @ts-nocheck` present on the file that declares the discriminated union
  // TypeScript reports missing-property errors against the *second* union
  // member. Putting the adapter branch second therefore makes
  // `new PrismaClient({ log: [...] })` report "adapter is missing" (the
  // recommended option for most users) rather than "accelerateUrl is missing".
  //
  // The source declaration order matches the union order so that the same
  // "adapter wins" behavior also holds for the internal client tests that
  // generate without the preamble (`tsNoCheckPreamble: false`); without
  // `// @ts-nocheck`, TypeScript picks the later-declared branch instead, so
  // both orderings need to put adapter last.
  const withAccelerateUrl = ts
    .interfaceDeclaration('PrismaClientOptionsWithAccelerateUrl')
    .extends(ts.namedType('PrismaClientBaseOptions'))
    .add(
      ts.property('accelerateUrl', ts.stringType).setDocComment(ts.docComment`
            The Prisma Accelerate connection URL. Use this option to connect to your database through Prisma Accelerate instead of using a driver adapter to connect directly.

            Learn more: https://pris.ly/d/accelerate
          `),
    )
    .add(ts.property('adapter', ts.neverType).optional())

  // Adapter-specific options interface that extends the base.
  // Matches `PrismaClientOptionsWithAdapter` in the runtime.
  const withAdapter = ts
    .interfaceDeclaration('PrismaClientOptionsWithAdapter')
    .extends(ts.namedType('PrismaClientBaseOptions'))
    .add(
      ts.property('adapter', ts.namedType('runtime.SqlDriverAdapterFactory')).setDocComment(ts.docComment`
            A driver adapter that PrismaClient uses to connect to your database, such as the ones provided by \`@prisma/adapter-pg\`, \`@prisma/adapter-libsql\`, \`@prisma/adapter-planetscale\`, etc.

            A driver adapter is **required** unless you connect to your database through Prisma Accelerate (in which case use \`accelerateUrl\` instead).

            Learn more: https://pris.ly/d/driver-adapters

            @example
            \`\`\`ts
            import { PrismaPg } from '@prisma/adapter-pg'
            import { PrismaClient } from './generated/prisma/client'

            const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
            const prisma = new PrismaClient({ adapter })
            \`\`\`
          `),
    )
    .add(ts.property('accelerateUrl', ts.neverType).optional())

  // NOTE: The union members are intentionally ordered with
  // `PrismaClientOptionsWithAdapter` *last*. TypeScript's missing-property
  // error elaboration for a discriminated union reports against the *second*
  // union member, so the adapter branch must come second to make
  // `new PrismaClient({ log: [...] })` say "adapter is missing" (the
  // recommended option for most users) rather than "accelerateUrl is missing".
  const prismaClientOptionsDecl = ts.typeDeclaration(
    'PrismaClientOptions',
    ts.unionType([
      ts.namedType('PrismaClientOptionsWithAccelerateUrl'),
      ts.namedType('PrismaClientOptionsWithAdapter'),
    ]),
  )

  return [
    ts.stringify(
      ts.moduleExport(baseOptions).setDocComment(ts.docComment`
        Options common to all variants of \`PrismaClientOptions\`, regardless of whether you connect to your database through a driver adapter or through Prisma Accelerate.
      `),
    ),
    ts.stringify(
      ts.moduleExport(withAccelerateUrl).setDocComment(ts.docComment`
        \`PrismaClient\` options for connecting to your database through Prisma Accelerate instead of a driver adapter.

        Learn more: https://pris.ly/d/accelerate
      `),
    ),
    ts.stringify(
      ts.moduleExport(withAdapter).setDocComment(ts.docComment`
        \`PrismaClient\` options for connecting to your database through a driver adapter. This is the common case in Prisma 7.

        Learn more: https://pris.ly/d/driver-adapters
      `),
    ),
    ts.stringify(
      ts.moduleExport(prismaClientOptionsDecl).setDocComment(ts.docComment`
        Options passed to the \`PrismaClient\` constructor.

        A driver adapter (or, alternatively, a Prisma Accelerate URL) is **required**. See {@link PrismaClientOptionsWithAdapter} and {@link PrismaClientOptionsWithAccelerateUrl} for the two variants. All other properties live in {@link PrismaClientBaseOptions} and are optional.

        Learn more about driver adapters: https://pris.ly/d/driver-adapters
      `),
    ),
  ].join('\n\n')
}
