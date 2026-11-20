import { capitalize, uncapitalize } from '@prisma/client-common'
import type * as DMMF from '@prisma/dmmf'
import * as ts from '@prisma/ts-builders'
import indent from 'indent-string'

import { runtimeImportedType } from '../utils/runtimeImport'
import { TAB_SIZE } from './constants'
import { GenerateContext } from './GenerateContext'
import { TSClientOptions } from './TSClient'
import * as tsx from './utils/type-builders'

function extendsPropertyDefinition() {
  const extendsDefinition = ts
    .namedType('runtime.Types.Extensions.ExtendsHook')
    .addGenericArgument(ts.stringLiteral('extends'))
    .addGenericArgument(ts.namedType('Prisma.TypeMapCb').addGenericArgument(ts.namedType('OmitOpts')))
    .addGenericArgument(ts.namedType('ExtArgs'))
    .addGenericArgument(
      ts
        .namedType('runtime.Types.Utils.Call')
        .addGenericArgument(ts.namedType('Prisma.TypeMapCb').addGenericArgument(ts.namedType('OmitOpts')))
        .addGenericArgument(ts.objectType().add(ts.property('extArgs', ts.namedType('ExtArgs')))),
    )
  return ts.stringify(ts.property('$extends', extendsDefinition), { indentLevel: 1 })
}

function batchingTransactionDefinition(context: GenerateContext) {
  const method = ts
    .method('$transaction')
    .setDocComment(
      ts.docComment`
        Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
        @example
        \`\`\`
        const [george, bob, alice] = await prisma.$transaction([
          prisma.user.create({ data: { name: 'George' } }),
          prisma.user.create({ data: { name: 'Bob' } }),
          prisma.user.create({ data: { name: 'Alice' } }),
        ])
        \`\`\`

        Read more in our [docs](https://www.prisma.io/docs/orm/prisma-client/queries/transactions).
      `,
    )
    .addGenericParameter(ts.genericParameter('P').extends(ts.array(tsx.prismaPromise(ts.anyType))))
    .addParameter(ts.parameter('arg', ts.arraySpread(ts.namedType('P'))))
    .setReturnType(tsx.promise(ts.namedType('runtime.Types.Utils.UnwrapTuple').addGenericArgument(ts.namedType('P'))))

  const options = ts.objectType().formatInline()
  options.add(ts.property('maxWait', ts.numberType).optional())
  options.add(ts.property('timeout', ts.numberType).optional())

  if (context.dmmf.hasEnumInNamespace('TransactionIsolationLevel', 'prisma')) {
    options.add(ts.property('isolationLevel', ts.namedType('Prisma.TransactionIsolationLevel')).optional())
  }

  method.addParameter(ts.parameter('options', options).optional())

  return ts.stringify(method, { indentLevel: 1, newLine: 'leading' })
}

function interactiveTransactionDefinition(context: GenerateContext) {
  const options = ts
    .objectType()
    .formatInline()
    .add(ts.property('maxWait', ts.numberType).optional())
    .add(ts.property('timeout', ts.numberType).optional())

  if (context.dmmf.hasEnumInNamespace('TransactionIsolationLevel', 'prisma')) {
    const isolationLevel = ts.property('isolationLevel', ts.namedType('Prisma.TransactionIsolationLevel')).optional()
    options.add(isolationLevel)
  }

  const returnType = tsx.promise(ts.namedType('R'))

  const callbackType = ts
    .functionType()
    .addParameter(ts.parameter('prisma', tsx.omit(ts.namedType('PrismaClient'), itxTransactionClientDenyList(context))))
    .setReturnType(returnType)

  const method = ts
    .method('$transaction')
    .addGenericParameter(ts.genericParameter('R'))
    .addParameter(ts.parameter('fn', callbackType))
    .addParameter(ts.parameter('options', options).optional())
    .setReturnType(returnType)

  return ts.stringify(method, { indentLevel: 1, newLine: 'leading' })
}

function itxTransactionClientDenyList(context: GenerateContext) {
  if (!context.isSqlProvider()) {
    return ts.unionType([ts.namedType('runtime.ITXClientDenyList'), ts.stringLiteral('$transaction')])
  }

  return ts.namedType('runtime.ITXClientDenyList')
}

function queryRawDefinition(context: GenerateContext) {
  // we do not generate `$queryRaw...` definitions if not supported
  if (!context.dmmf.mappings.otherOperations.write.includes('queryRaw')) {
    return '' // https://github.com/prisma/prisma/issues/8189
  }

  return `
  /**
   * Performs a prepared raw query and returns the \`SELECT\` data.
   * @example
   * \`\`\`
   * const result = await prisma.$queryRaw\`SELECT * FROM User WHERE id = \${1} OR email = \${'user@email.com'};\`
   * \`\`\`
   *
   * Read more in our [docs](https://pris.ly/d/raw-queries).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the \`SELECT\` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * \`\`\`
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * \`\`\`
   *
   * Read more in our [docs](https://pris.ly/d/raw-queries).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;`
}

function executeRawDefinition(context: GenerateContext) {
  // we do not generate `$executeRaw...` definitions if not supported
  if (!context.dmmf.mappings.otherOperations.write.includes('executeRaw')) {
    return '' // https://github.com/prisma/prisma/issues/8189
  }

  return `
  /**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * \`\`\`
   * const result = await prisma.$executeRaw\`UPDATE User SET cool = \${true} WHERE email = \${'user@email.com'};\`
   * \`\`\`
   *
   * Read more in our [docs](https://pris.ly/d/raw-queries).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * \`\`\`
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * \`\`\`
   *
   * Read more in our [docs](https://pris.ly/d/raw-queries).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;`
}

function queryRawTypedDefinition(context: GenerateContext) {
  if (!context.isPreviewFeatureOn('typedSql')) {
    return ''
  }
  if (!context.dmmf.mappings.otherOperations.write.includes('queryRaw')) {
    return ''
  }

  const param = ts.genericParameter('T')
  const method = ts
    .method('$queryRawTyped')
    .setDocComment(
      ts.docComment`
        Executes a typed SQL query and returns a typed result
        @example
        \`\`\`
        import { myQuery } from '@prisma/client/sql'

        const result = await prisma.$queryRawTyped(myQuery())
        \`\`\`
      `,
    )
    .addGenericParameter(param)
    .addParameter(
      ts.parameter(
        'typedSql',
        runtimeImportedType('TypedSql')
          .addGenericArgument(ts.array(ts.unknownType))
          .addGenericArgument(param.toArgument()),
      ),
    )
    .setReturnType(tsx.prismaPromise(ts.array(param.toArgument())))

  return ts.stringify(method, { indentLevel: 1, newLine: 'leading' })
}

function runCommandRawDefinition(context: GenerateContext) {
  // we do not generate `$runCommandRaw` definitions if not supported
  if (!context.dmmf.mappings.otherOperations.write.includes('runCommandRaw')) {
    return '' // https://github.com/prisma/prisma/issues/8189
  }

  const method = ts
    .method('$runCommandRaw')
    .addParameter(ts.parameter('command', ts.namedType('Prisma.InputJsonObject')))
    .setReturnType(tsx.prismaPromise(ts.namedType('Prisma.JsonObject'))).setDocComment(ts.docComment`
      Executes a raw MongoDB command and returns the result of it.
      @example
      \`\`\`
      const user = await prisma.$runCommandRaw({
        aggregate: 'User',
        pipeline: [{ $match: { name: 'Bob' } }, { $project: { email: true, _id: false } }],
        explain: false,
      })
      \`\`\`

      Read more in our [docs](https://pris.ly/d/raw-queries).
    `)

  return ts.stringify(method, { indentLevel: 1, newLine: 'leading' })
}

export function getPrismaClientClassDocComment({ dmmf }: GenerateContext): ts.DocComment {
  let example: DMMF.ModelMapping

  if (dmmf.mappings.modelOperations.length) {
    example = dmmf.mappings.modelOperations[0]
  } else {
    // because generator models is empty we need to create a fake example
    example = {
      model: 'User',
      plural: 'users',
    }
  }

  return ts.docComment`
    ## Prisma Client

    Type-safe database client for TypeScript
    @example
    \`\`\`
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
    })
    // Fetch zero or more ${capitalize(example.plural)}
    const ${uncapitalize(example.plural)} = await prisma.${uncapitalize(example.model)}.findMany()
    \`\`\`

    Read more in our [docs](https://pris.ly/d/client).
  `
}

export class PrismaClientClass {
  constructor(
    private readonly context: GenerateContext,
    private readonly runtimeName: TSClientOptions['runtimeName'],
  ) {}

  private get jsDoc(): string {
    return ts.stringify(getPrismaClientClassDocComment(this.context))
  }

  public toTS(): string {
    const { dmmf } = this.context

    return `\
export type LogOptions<ClientOptions extends Prisma.PrismaClientOptions> =
  'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never

export interface PrismaClientConstructor {
  ${indent(this.jsDoc, TAB_SIZE)}
  new <
    Options extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
    LogOpts extends LogOptions<Options> = LogOptions<Options>,
    OmitOpts extends Prisma.PrismaClientOptions['omit'] = Options extends { omit: infer U } ? U : Prisma.PrismaClientOptions['omit'],
    ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs
  >(options: Prisma.PrismaClientConstructorArgs<Options>): PrismaClient<LogOpts, OmitOpts, ExtArgs>
}

${this.jsDoc}
export interface PrismaClient<
  in LogOpts extends Prisma.LogLevel = never,
  in out OmitOpts extends Prisma.PrismaClientOptions['omit'] = Prisma.PrismaClientOptions['omit'],
  in out ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

  $on<V extends LogOpts>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): PrismaClient;

  /**
   * Connect with the database
   */
  $connect(): runtime.Types.Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): runtime.Types.Utils.JsPromise<void>;

${[
  executeRawDefinition(this.context),
  queryRawDefinition(this.context),
  queryRawTypedDefinition(this.context),
  batchingTransactionDefinition(this.context),
  interactiveTransactionDefinition(this.context),
  runCommandRawDefinition(this.context),
  extendsPropertyDefinition(),
]
  .filter((d) => d !== null)
  .join('\n')
  .trim()}

    ${indent(
      dmmf.mappings.modelOperations
        .filter((m) => m.findMany)
        .map((m) => {
          let methodName = uncapitalize(m.model)
          if (methodName === 'constructor') {
            methodName = '["constructor"]'
          }
          const generics = ['ExtArgs', '{ omit: OmitOpts }']
          return `\
/**
 * \`prisma.${methodName}\`: Exposes CRUD operations for the **${m.model}** model.
  * Example usage:
  * \`\`\`ts
  * // Fetch zero or more ${capitalize(m.plural)}
  * const ${uncapitalize(m.plural)} = await prisma.${methodName}.findMany()
  * \`\`\`
  */
get ${methodName}(): Prisma.${m.model}Delegate<${generics.join(', ')}>;`
        })
        .join('\n\n'),
      2,
    )}
}`
  }
}
