import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider, randomString, previewFeatures, id }) => {
  return /* Prisma */ `
    generator client {
      provider = "prisma-client-js"
      output   = "../generated/prisma/client"
      previewFeatures = [${previewFeatures}]
    }
    
    datasource db {
      provider = "${provider}"
    }
    
    model User {
      id ${id}
      ${randomString} String
    }
  `
})
