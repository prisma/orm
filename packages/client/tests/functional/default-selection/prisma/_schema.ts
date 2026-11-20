import { foreignKeyForProvider, idForProvider } from '../../_utils/idForProvider'
import { Providers } from '../../_utils/providers'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  const fields: string[] = []
  const declarations: string[] = []

  if (provider === Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.MONGODB) {
    fields.push('list String[]')
  }

  if (provider !== Providers.SQLITE && provider !== Providers.SQLSERVER) {
    declarations.push(/* Prisma */ `
    enum Enum {
      A
      B
    }`)

    fields.push('enum Enum')

    if (provider !== Providers.MYSQL) {
      fields.push('enumList Enum[]')
    }
  }

  if (provider === Providers.MONGODB) {
    declarations.push(/* Prisma */ `
    type Composite {
      value String
    }
    `)
    fields.push('composite Composite')
  }

  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }
  
  datasource db {
    provider = "${provider}"
  }
  
  model Model {
    id ${idForProvider(provider)}
    value String
    otherId ${foreignKeyForProvider(provider)} @unique
    relation Other @relation(fields: [otherId], references: [id])
    ${fields.join('\n')}
  }

  model Other {
    id ${idForProvider(provider)}
    model Model?
  }

${declarations.join('\n')}

  `
})
