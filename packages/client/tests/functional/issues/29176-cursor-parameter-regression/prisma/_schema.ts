import { idForProvider } from '../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
    generator client {
      provider  = "prisma-client-js"
    }

    datasource db {
      provider = "${provider}"
    }

    model ListResult {
      id ${idForProvider(provider)}
      connection_uuid  String
      query_ref        String
      result_index     Int

      @@unique([connection_uuid, query_ref, result_index])
    }
  `
})
