import { idForProvider } from '../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }
  
  datasource db {
    provider = "${provider}"
  }
  
  model NullableJsonField {
    id   ${idForProvider(provider)}
    json Json?
  }

  model RequiredJsonField {
    id   ${idForProvider(provider)}
    json Json
  }
  `
})
