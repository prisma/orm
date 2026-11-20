import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider, relationMode }) => {
  return /* Prisma */ `
    generator client {
      provider = "prisma-client-js"
    }

    datasource db {
      provider = "${provider}"
      relationMode = "${relationMode}"
    }

    model Group {
      id      String   @id
      parents Parent[]
    }

    model Parent {
      id      String  @id
      child   Child?
      groupId String?
      group   Group?  @relation(fields: [groupId], references: [id], onDelete: Cascade)
    }

    model Child {
      id       String @id
      parentId String @unique
      parent   Parent @relation(fields: [parentId], references: [id], onDelete: Cascade)
    }

    model NullableParent {
      id    String @id
      child NullableChild?
    }

    model NullableChild {
      id       String          @id
      parentId String?         @unique
      parent   NullableParent? @relation(fields: [parentId], references: [id], onDelete: SetNull)
    }
  `
})
