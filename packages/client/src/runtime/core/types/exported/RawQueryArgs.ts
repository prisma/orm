import { RawValue, Sql } from '@prisma/client-runtime-utils'

import { UnknownTypedSql } from './TypedSql'

export type RawQueryArgs = Sql | UnknownTypedSql | [query: string, ...values: RawValue[]]
