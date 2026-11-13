import testMatrix from '../_matrix'

export default testMatrix.setupSchema(() => {
  return /* Prisma */ `
    generator client {
      provider = "prisma-client-js"
    }

    datasource db {
      provider = "mysql"
    }

    // Placeholder model to satisfy client generation; the SET column under test
    // is created via $executeRaw in tests.ts because Prisma's schema language
    // does not model the MySQL SET type.
    model A {
      id Int @id @default(autoincrement())
    }
  `
})
