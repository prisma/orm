import { type Client, type Config, createClient } from '@libsql/client/web'

import { PrismaLibSqlAdapterFactoryBase } from './libsql'

export class PrismaLibSqlWebAdapterFactory extends PrismaLibSqlAdapterFactoryBase {
  createClient(config: Config): Client {
    return createClient(config)
  }
}
