import { idForProvider } from '../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }
  
  datasource db {
    provider = "${provider}"
  }

  model Product {
    id ${idForProvider(provider)}
    title String
    quantity Int
    forbiddenQuantities Int[]
    enum1 MyEnum
    enum2 MyEnum[]
  }

  enum MyEnum {
    a
    b
    c
  }
  `
})
