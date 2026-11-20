import { Sql } from '@prisma/client-runtime-utils'
import { Debug } from '@prisma/debug'

import { MiddlewareArgsMapper } from '../../getPrismaClient'
import { mssqlPreparedStatement } from '../../utils/mssqlPreparedStatement'
import { serializeRawParameters } from '../../utils/serializeRawParameters'
import { isTypedSql } from '../types/exported'
import { RawQueryArgs } from '../types/exported/RawQueryArgs'

const ALTER_RE = /^(\s*alter\s)/i

const debug = Debug('prisma:client')

// TODO also check/disallow for CREATE, DROP
export function checkAlter(activeProvider: string, query: string, values: unknown[], invalidCall: string) {
  if (activeProvider !== 'postgresql' && activeProvider !== 'cockroachdb') {
    return
  }
  if (values.length > 0 && ALTER_RE.exec(query)) {
    // See https://github.com/prisma/prisma-client-js/issues/940 for more info
    throw new Error(`Running ALTER using ${invalidCall} is not supported
Using the example below you can still execute your query with Prisma, but please note that it is vulnerable to SQL injection attacks and requires you to take care of input sanitization.

Example:
  await prisma.$executeRawUnsafe(\`ALTER USER prisma WITH PASSWORD '\${password}'\`)

More Information: https://pris.ly/d/execute-raw
`)
  }
}

type RawQueryArgsMapperInput = {
  clientMethod: string
  activeProvider: string
  clientVersion: string
}

export const rawQueryArgsMapper =
  ({ clientMethod, activeProvider, clientVersion }: RawQueryArgsMapperInput) =>
  (args: RawQueryArgs) => {
    // TODO Clean up types
    let queryString = ''
    let parameters: { values: string; __prismaRawParameters__: true } | undefined
    if (isTypedSql(args)) {
      queryString = args.sql
      parameters = {
        values: serializeRawParameters(args.values, clientVersion),
        __prismaRawParameters__: true,
      }
    } else if (Array.isArray(args)) {
      // If this was called as prisma.$executeRaw(<SQL>, [...values]), assume it is a pre-prepared SQL statement, and forward it without any changes
      const [query, ...values] = args
      queryString = query
      parameters = {
        values: serializeRawParameters(values || [], clientVersion),
        __prismaRawParameters__: true,
      }
    } else {
      // If this was called as prisma.$executeRaw`<SQL>` try to generate a SQL prepared statement
      switch (activeProvider) {
        case 'sqlite':
        case 'mysql': {
          queryString = args.sql
          parameters = {
            values: serializeRawParameters(args.values, clientVersion),
            __prismaRawParameters__: true,
          }
          break
        }

        case 'cockroachdb':
        case 'postgresql':
        case 'postgres': {
          queryString = args.text

          parameters = {
            values: serializeRawParameters(args.values, clientVersion),
            __prismaRawParameters__: true,
          }
          break
        }

        case 'sqlserver': {
          queryString = mssqlPreparedStatement(args)
          parameters = {
            values: serializeRawParameters(args.values, clientVersion),
            __prismaRawParameters__: true,
          }
          break
        }
        default: {
          throw new Error(`The ${activeProvider} provider does not support ${clientMethod}`)
        }
      }
    }

    if (parameters?.values) {
      debug(`prisma.${clientMethod}(${queryString}, ${parameters.values})`)
    } else {
      debug(`prisma.${clientMethod}(${queryString})`)
    }

    return { query: queryString, parameters }
  }

type MiddlewareRawArgsTemplateString = [string[], ...unknown[]]
type MiddlewareRawArgsSql = [Sql]

export const templateStringMiddlewareArgsMapper: MiddlewareArgsMapper<Sql, MiddlewareRawArgsTemplateString> = {
  requestArgsToMiddlewareArgs(sql) {
    return [sql.strings, ...sql.values]
  },

  middlewareArgsToRequestArgs(requestArgs) {
    const [strings, ...values] = requestArgs
    return new Sql(strings, values)
  },
}

export const sqlMiddlewareArgsMapper: MiddlewareArgsMapper<Sql, MiddlewareRawArgsSql> = {
  requestArgsToMiddlewareArgs(sql) {
    return [sql]
  },

  middlewareArgsToRequestArgs(requestArgs) {
    return requestArgs[0]
  },
}
