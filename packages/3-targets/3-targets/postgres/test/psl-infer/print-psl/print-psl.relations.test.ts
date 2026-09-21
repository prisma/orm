import { parseNaming } from '@internal/sql-schema-ir/naming';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { printPslFromFlat as printPslFromSql } from '../fixtures';

describe('printPsl', () => {
  it('schema with 1:N relation', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            name: { name: 'name', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        post: {
          name: 'post',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            title: { name: 'title', nativeType: 'text', nullable: false },
            user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['user_id'],
              referencedTable: 'user',
              referencedColumns: ['id'],
            },
          ],
          uniques: [],
          indexes: [
            {
              naming: parseNaming('post_user_id_idx', undefined),
              columns: ['user_id'],
              where: undefined,
              unique: false,
              partial: false,
              type: undefined,
              options: undefined,
              annotations: undefined,
              dependsOn: undefined,
            },
          ],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model User {
        id    Int    @id
        name  String
        posts Post[]

        @@map("user")
      }

      model Post {
        id     Int    @id
        title  String
        userId Int    @map("user_id")
        user   User   @relation(fields: [userId], references: [id])

        @@index([userId], map: "post_user_id_idx")
        @@map("post")
      }
      "
    `);
  });

  it('stamps index: false when the FK column has no live backing index, unique, or PK', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        post: {
          name: 'post',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['user_id'],
              referencedTable: 'user',
              referencedColumns: ['id'],
            },
          ],
          uniques: [],
          indexes: [],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model User {
        id    Int    @id
        posts Post[]

        @@map("user")
      }

      model Post {
        id     Int  @id
        userId Int  @map("user_id")
        user   User @relation(fields: [userId], references: [id], index: false)

        @@map("post")
      }
      "
    `);
  });

  it('schema with 1:1 relation (FK column is unique)', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        profile: {
          name: 'profile',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
            bio: { name: 'bio', nativeType: 'text', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['user_id'],
              referencedTable: 'user',
              referencedColumns: ['id'],
            },
          ],
          uniques: [{ columns: ['user_id'] }],
          indexes: [],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model User {
        id      Int      @id
        profile Profile?

        @@map("user")
      }

      model Profile {
        id     Int     @id
        userId Int     @unique @map("user_id")
        bio    String?
        user   User    @relation(fields: [userId], references: [id])

        @@map("profile")
      }
      "
    `);
  });

  it('schema with 1:1 relation from a composite unique foreign key', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        account: {
          name: 'account',
          columns: {
            tenant_id: {
              name: 'tenant_id',
              nativeType: 'int4',
              nullable: false,
            },
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['tenant_id', 'id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        profile: {
          name: 'profile',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            tenant_id: {
              name: 'tenant_id',
              nativeType: 'int4',
              nullable: false,
            },
            account_id: {
              name: 'account_id',
              nativeType: 'int4',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['tenant_id', 'account_id'],
              referencedTable: 'account',
              referencedColumns: ['tenant_id', 'id'],
            },
          ],
          uniques: [{ columns: ['tenant_id', 'account_id'] }],
          indexes: [],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Account {
        tenantId Int      @map("tenant_id")
        id       Int
        profile  Profile?

        @@id([tenantId, id])
        @@map("account")
      }

      model Profile {
        id        Int     @id
        tenantId  Int     @map("tenant_id")
        accountId Int     @map("account_id")
        account   Account @relation(fields: [tenantId, accountId], references: [tenantId, id])

        @@unique([tenantId, accountId])
        @@map("profile")
      }
      "
    `);
  });

  it('self-referencing FK', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        employee: {
          name: 'employee',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            name: { name: 'name', nativeType: 'text', nullable: false },
            manager_id: {
              name: 'manager_id',
              nativeType: 'int4',
              nullable: true,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['manager_id'],
              referencedTable: 'employee',
              referencedColumns: ['id'],
            },
          ],
          uniques: [],
          indexes: [],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Employee {
        id        Int        @id
        name      String
        managerId Int?       @map("manager_id")
        manager   Employee?  @relation(name: "ManagerEmployees", fields: [managerId], references: [id], index: false)
        employees Employee[] @relation(name: "ManagerEmployees")

        @@map("employee")
      }
      "
    `);
  });

  it('multiple FKs to same table (named relations)', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        message: {
          name: 'message',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            sender_id: {
              name: 'sender_id',
              nativeType: 'int4',
              nullable: false,
            },
            recipient_id: {
              name: 'recipient_id',
              nativeType: 'int4',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              name: 'message_sender_fk',
              columns: ['sender_id'],
              referencedTable: 'user',
              referencedColumns: ['id'],
            },
            {
              name: 'message_recipient_fk',
              columns: ['recipient_id'],
              referencedTable: 'user',
              referencedColumns: ['id'],
            },
          ],
          uniques: [],
          indexes: [],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model User {
        id              Int       @id
        messages        Message[] @relation(name: "message_sender_fk")
        messagesMessage Message[] @relation(name: "message_recipient_fk")

        @@map("user")
      }

      model Message {
        id          Int  @id
        senderId    Int  @map("sender_id")
        recipientId Int  @map("recipient_id")
        sender      User @relation(name: "message_sender_fk", fields: [senderId], references: [id], map: "message_sender_fk", index: false)
        recipient   User @relation(name: "message_recipient_fk", fields: [recipientId], references: [id], map: "message_recipient_fk", index: false)

        @@map("message")
      }
      "
    `);
  });

  it('composite FK relation fields use table name', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        product: {
          name: 'product',
          columns: {
            category_id: {
              name: 'category_id',
              nativeType: 'int4',
              nullable: false,
            },
            product_id: {
              name: 'product_id',
              nativeType: 'int4',
              nullable: false,
            },
          },
          primaryKey: { columns: ['category_id', 'product_id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        review: {
          name: 'review',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            product_category_id: {
              name: 'product_category_id',
              nativeType: 'int4',
              nullable: false,
            },
            product_product_id: {
              name: 'product_product_id',
              nativeType: 'int4',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['product_category_id', 'product_product_id'],
              referencedTable: 'product',
              referencedColumns: ['category_id', 'product_id'],
            },
          ],
          uniques: [],
          indexes: [],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Product {
        categoryId Int      @map("category_id")
        productId  Int      @map("product_id")
        reviews    Review[]

        @@id([categoryId, productId])
        @@map("product")
      }

      model Review {
        id                Int     @id
        productCategoryId Int     @map("product_category_id")
        productProductId  Int     @map("product_product_id")
        product           Product @relation(fields: [productCategoryId, productProductId], references: [categoryId, productId], index: false)

        @@map("review")
      }
      "
    `);
  });

  it('onDelete and onUpdate referential actions', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        parent: {
          name: 'parent',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        child: {
          name: 'child',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            parent_id: {
              name: 'parent_id',
              nativeType: 'int4',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['parent_id'],
              referencedTable: 'parent',
              referencedColumns: ['id'],
              onDelete: 'cascade',
              onUpdate: 'cascade',
            },
          ],
          uniques: [],
          indexes: [],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Parent {
        id       Int     @id
        children Child[]

        @@map("parent")
      }

      model Child {
        id       Int    @id
        parentId Int    @map("parent_id")
        parent   Parent @relation(fields: [parentId], references: [id], onDelete: Cascade, onUpdate: Cascade, index: false)

        @@map("child")
      }
      "
    `);
  });

  it('preserves foreign key constraint names with relation map arguments', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        team: {
          name: 'team',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        member: {
          name: 'member',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            team_id: { name: 'team_id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              name: 'member_team_id_fkey',
              columns: ['team_id'],
              referencedTable: 'team',
              referencedColumns: ['id'],
            },
          ],
          uniques: [],
          indexes: [],
        },
      },
    });

    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Team {
        id      Int      @id
        members Member[]

        @@map("team")
      }

      model Member {
        id     Int  @id
        teamId Int  @map("team_id")
        team   Team @relation(fields: [teamId], references: [id], map: "member_team_id_fkey", index: false)

        @@map("member")
      }
      "
    `);
  });

  it('orders cyclic table dependencies deterministically', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        alpha: {
          name: 'alpha',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            beta_id: { name: 'beta_id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            { columns: ['beta_id'], referencedTable: 'beta', referencedColumns: ['id'] },
          ],
          uniques: [],
          indexes: [],
        },
        beta: {
          name: 'beta',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            alpha_id: {
              name: 'alpha_id',
              nativeType: 'int4',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            { columns: ['alpha_id'], referencedTable: 'alpha', referencedColumns: ['id'] },
          ],
          uniques: [],
          indexes: [],
        },
      },
    });

    const result = printPslFromSql(schemaIR);
    const betaIndex = result.indexOf('model Beta');
    const alphaIndex = result.indexOf('model Alpha');

    expect(betaIndex).toBeGreaterThanOrEqual(0);
    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(betaIndex).toBeLessThan(alphaIndex);
  });
});
