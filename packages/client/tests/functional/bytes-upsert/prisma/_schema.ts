import { idForProvider } from '../../_utils/idForProvider'
import { Providers } from '../../_utils/providers'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }

  datasource db {
    provider = "${provider}"
  }

  model TestByteId {
    id ${idForProvider(provider, { includeDefault: true })}
    bytes Bytes @unique${provider === Providers.MYSQL ? ' @db.VarBinary(16)' : ''}
  }
  `
})
