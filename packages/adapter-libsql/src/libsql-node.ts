import { type Client, type Config, createClient } from '@libsql/client'

import { PrismaLibSqlAdapterFactoryBase } from './libsql'

export class PrismaLibSqlAdapterFactory extends PrismaLibSqlAdapterFactoryBase {
  createClient(config: Config): Client {
    return createClient(config)
  }
}
