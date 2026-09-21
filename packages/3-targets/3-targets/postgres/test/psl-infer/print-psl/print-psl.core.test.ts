import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { printPslFromFlat as printPslFromSql } from '../fixtures';

describe('printPsl', () => {
  it('empty schema', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {},
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.
      "
    `);
  });

  it('simple schema with single table', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            email: { name: 'email', nativeType: 'text', nullable: false },
            name: { name: 'name', nativeType: 'text', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [{ columns: ['email'] }],
          indexes: [],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model User {
        id    Int     @id
        email String  @unique
        name  String?

        @@map("user")
      }
      "
    `);
  });

  it('table without primary key', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        audit_log: {
          name: 'audit_log',
          columns: {
            event: { name: 'event', nativeType: 'text', nullable: false },
            timestamp: {
              name: 'timestamp',
              nativeType: 'timestamptz',
              nullable: false,
            },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      // WARNING: This table has no primary key in the database
      model AuditLog {
        event     String
        timestamp Timestamptz

        @@map("audit_log")
      }
      "
    `);
  });

  it('composite primary key', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        order_item: {
          name: 'order_item',
          columns: {
            order_id: { name: 'order_id', nativeType: 'int4', nullable: false },
            product_id: {
              name: 'product_id',
              nativeType: 'int4',
              nullable: false,
            },
            quantity: { name: 'quantity', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['order_id', 'product_id'], name: 'order_item_pkey' },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model OrderItem {
        orderId   Int @map("order_id")
        productId Int @map("product_id")
        quantity  Int

        @@id([orderId, productId], map: "order_item_pkey")
        @@map("order_item")
      }
      "
    `);
  });

  it('deterministic output: same input always produces same output', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        b_table: {
          name: 'b_table',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        a_table: {
          name: 'a_table',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });
    const result1 = printPslFromSql(schemaIR);
    const result2 = printPslFromSql(schemaIR);
    expect(result1).toBe(result2);
    expect(result1.indexOf('ATable')).toBeLessThan(result1.indexOf('BTable'));
  });
});
